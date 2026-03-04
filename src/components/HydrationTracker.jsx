import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../context/AuthContext';
import { db } from '../firebase';
import {
    doc,
    setDoc,
    collection,
    query,
    getDocs,
    serverTimestamp,
    onSnapshot,
    deleteDoc
} from 'firebase/firestore';
import './HydrationTracker.css';

const DEFAULT_WATER_GOAL = 2500; // mL
const DAYS_IN_WEEK = 7;
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const formatDateKey = (date) => {
    // Manually format to YYYY-MM-DD using local time
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

// Helper: Weeks builder (same as SleepTracker)
const buildWeeksInRange = (counts, startDate, endDate) => {
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const day = start.getDay();
    const diff = day === 0 ? 6 : day - 1;
    start.setDate(start.getDate() - diff);

    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    const endDay = end.getDay();
    const endDiff = endDay === 0 ? 0 : 7 - endDay;
    end.setDate(end.getDate() + endDiff);

    const weeks = [];
    let currentWeek = [];

    for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
        const dayClone = new Date(cursor);
        dayClone.setHours(0, 0, 0, 0);
        const key = formatDateKey(dayClone);
        const val = counts[key] || 0;

        currentWeek.push({
            date: dayClone,
            key,
            count: val,
        });

        if (currentWeek.length === DAYS_IN_WEEK) {
            weeks.push(currentWeek);
            currentWeek = [];
        }
    }
    if (currentWeek.length > 0) weeks.push(currentWeek);
    return weeks;
};

const HydrationTracker = () => {
    const { user } = useAuth();
    const todayKey = useMemo(() => formatDateKey(new Date()), []);

    // Current State
    const [waterAmount, setWaterAmount] = useState(0);
    const [waterGoal, setWaterGoal] = useState(DEFAULT_WATER_GOAL);



    // History & Heatmap State
    const [showHistoryModal, setShowHistoryModal] = useState(false);
    const [showFullHistory, setShowFullHistory] = useState(false);
    const [hydrationHistory, setHydrationHistory] = useState([]); // List of past docs
    const [hydrationCounts, setHydrationCounts] = useState({}); // { '2023-10-25': 2500 }

    // Manual Entry / Edit State
    const [isEntryMode, setIsEntryMode] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [manualDate, setManualDate] = useState('');
    const [manualAmount, setManualAmount] = useState('');

    // Goal State
    const [showGoalInput, setShowGoalInput] = useState(false);
    const [newGoal, setNewGoal] = useState('');
    const [isSurging, setIsSurging] = useState(false);

    // --- Goal Listener ---
    useEffect(() => {
        if (!user) return;
        const unsub = onSnapshot(doc(db, 'users', user.uid, 'settings', 'hydration'), (docSnap) => {
            if (docSnap.exists()) {
                setWaterGoal(docSnap.data().dailyGoal || 2500);
            }
        });
        return () => unsub();
    }, [user]);

    const saveGoal = async () => {
        const g = parseInt(newGoal, 10);
        if (g > 0) {
            await setDoc(doc(db, 'users', user.uid, 'settings', 'hydration'), { dailyGoal: g }, { merge: true });
            setShowGoalInput(false);
            setNewGoal('');
        }
    };

    // --- 1. Real-time Listener for Today ---
    useEffect(() => {
        if (!user) return;
        const waterDocRef = doc(db, 'users', user.uid, 'temple_water', todayKey);
        const unsub = onSnapshot(waterDocRef, (snapshot) => {
            if (snapshot.exists()) {
                const data = snapshot.data();
                setWaterAmount(data.amount || 0);
                setWaterGoal(data.goal || DEFAULT_WATER_GOAL);
            } else {
                setWaterAmount(0);
            }
        });
        return () => unsub();
    }, [user, todayKey]);

    // --- 2. Update Water Function ---
    const updateWater = async (change) => {
        if (!user) return;

        // Trigger surge animation for positive adds
        if (change > 0) {
            setIsSurging(true);
            setTimeout(() => setIsSurging(false), 1000);
        }

        const waterDocRef = doc(db, 'users', user.uid, 'temple_water', todayKey);
        const newAmount = Math.max(0, waterAmount + change);
        setWaterAmount(newAmount); // Optimistic

        try {
            await setDoc(waterDocRef, {
                amount: newAmount,
                goal: waterGoal,
                updatedAt: serverTimestamp()
            }, { merge: true });

            // Also update local cache for heatmap immediately if possible, 
            // but fetching full heatmap is safer to keep common logic.
            // For now, simple optimistic UI is enough for the main view.
        } catch (err) {
            console.error("Error updating water:", err);
        }
    };

    // --- 3. Fetch History & Heatmap Data ---
    const fetchHistoryData = useCallback(async () => {
        if (!user) return;
        // Fetch all docs from subcollection 'temple_water'
        // Since we store one doc per day with ID=Date, we can query all.
        const q = query(collection(db, 'users', user.uid, 'temple_water'));
        const snapshot = await getDocs(q);

        const counts = {};
        const historyList = [];

        snapshot.docs.forEach(docSnap => {
            const data = docSnap.data();
            const dateKey = docSnap.id; // YYYY-MM-DD
            const amt = data.amount || 0;

            counts[dateKey] = amt;
            historyList.push({
                id: docSnap.id,
                dateKey,
                amount: amt,
                goal: data.goal || DEFAULT_WATER_GOAL
            });
        });

        // Sort history desc
        historyList.sort((a, b) => b.dateKey.localeCompare(a.dateKey));

        setHydrationCounts(counts);
        setHydrationHistory(historyList);
    }, [user]);

    useEffect(() => {
        if (user) {
            fetchHistoryData();
        }
    }, [user, fetchHistoryData]);

    // --- Actions: Save Manual, Edit, Delete ---
    const handleSaveManual = async () => {
        if (!user || !manualDate || !manualAmount) return;
        const val = parseInt(manualAmount, 10);
        if (isNaN(val) || val < 0) return;

        try {
            const docRef = doc(db, 'users', user.uid, 'temple_water', manualDate);
            await setDoc(docRef, {
                amount: val,
                goal: waterGoal,
                updatedAt: serverTimestamp()
            }, { merge: true });

            setIsEntryMode(false);
            setManualDate('');
            setManualAmount('');
            setEditingId(null);
            fetchHistoryData();

            // If updated today's data manually, reflect it in main view immediately
            if (manualDate === todayKey) {
                setWaterAmount(val);
            }
        } catch (err) {
            console.error("Error saving water:", err);
        }
    };

    const handleDelete = async (id) => {
        if (!user) return;
        if (!window.confirm("Delete this log?")) return;
        try {
            await deleteDoc(doc(db, 'users', user.uid, 'temple_water', id));
            fetchHistoryData();
            if (id === todayKey) setWaterAmount(0);
        } catch (err) {
            console.error(err);
        }
    };

    const handleEdit = (item) => {
        setManualDate(item.dateKey);
        setManualAmount(item.amount);
        setEditingId(item.id);
        setIsEntryMode(true);
    };

    // --- 4. Chart Data (Current Week) ---
    // Note: Hydration uses the same X-Axis logic as Sleep? Or simpler?
    // SleepChart is last 7 days from Monday. Let's stick to that pattern.
    const weeklyChartData = useMemo(() => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Start from 6 days ago -> Today (total 7 days)
        const startDate = new Date(today);
        startDate.setDate(today.getDate() - 6);

        const data = [];
        const dayLabels = ['Su', 'M', 'T', 'W', 'Th', 'F', 'S']; // 0=Sun

        for (let i = 0; i < 7; i++) {
            const cursor = new Date(startDate);
            cursor.setDate(startDate.getDate() + i);
            const key = formatDateKey(cursor);
            const label = dayLabels[cursor.getDay()];

            let val = 0;
            if (key === todayKey) {
                val = waterAmount;
            } else {
                val = hydrationCounts[key] || 0;
            }

            // Ideally we need hydrationCounts to include today's updated value.
            // But since fetchHistoryData is only called on modal open,
            // The chart on the MAIN CARD needs live data for today.

            data.push({
                day: label,
                val: Math.round(val / 100) / 10, // Convert to Liters (e.g. 2500 -> 2.5)
                raw: val,
                isToday: key === todayKey
            });
        }
        return data;
    }, [hydrationCounts, waterAmount, todayKey]);


    // --- 5. Heatmap Memoization ---
    const recentWeeks = useMemo(() => {
        const end = new Date();
        const start = new Date();
        start.setMonth(start.getMonth() - 3);
        // We need to merge today's live amount into counts for accurate heatmap
        const mergedCounts = { ...hydrationCounts, [todayKey]: waterAmount };
        return buildWeeksInRange(mergedCounts, start, end);
    }, [hydrationCounts, waterAmount, todayKey]);

    const allYearsWeeks = useMemo(() => {
        const mergedCounts = { ...hydrationCounts, [todayKey]: waterAmount };
        const yearsInData = Object.keys(mergedCounts).map(k => parseInt(k.split('-')[0]));

        if (yearsInData.length === 0) {
            const currentYear = new Date().getFullYear();
            return [{
                year: currentYear,
                weeks: buildWeeksInRange(mergedCounts, new Date(currentYear, 0, 1), new Date(currentYear, 11, 31))
            }];
        }
        const minYear = Math.min(...yearsInData);
        const maxYear = new Date().getFullYear();
        const timeline = [];
        for (let y = maxYear; y >= minYear; y--) {
            timeline.push({
                year: y,
                weeks: buildWeeksInRange(mergedCounts, new Date(y, 0, 1), new Date(y, 11, 31))
            });
        }
        return timeline;
    }, [hydrationCounts, waterAmount, todayKey]);

    // Helpers
    const getMonthLabels = (weeks, contextYear) => {
        return weeks.map((week, index) => {
            const firstDayOfMonth = week.find(day => day.date && day.date.getDate() === 1);
            if (firstDayOfMonth) {
                if (contextYear && firstDayOfMonth.date.getFullYear() !== contextYear) {
                    return { label: '', key: `month-${index}` };
                }
                return { label: MONTH_LABELS[firstDayOfMonth.date.getMonth()], key: `month-${index}` };
            }
            if (index === 0 && week[0]?.date) {
                return { label: MONTH_LABELS[week[0].date.getMonth()], key: `month-${index}` };
            }
            return { label: '', key: `month-${index}` };
        });
    };

    const getLevelClass = (ml) => {
        if (!ml) return 'profile-heatmap__day--level0';
        // Hydration Levels (assuming 2500 goal)
        if (ml >= 2500) return 'profile-heatmap__day--level4'; // Met goal
        if (ml >= 1800) return 'profile-heatmap__day--level3';
        if (ml >= 1200) return 'profile-heatmap__day--level2';
        return 'profile-heatmap__day--level1';
    };




    return (
        <div className="water-tracker-card sketch-layout" style={{ position: 'relative' }}>
            <div className="water-card-header">
                <div>
                    <h2 className="water-title">Hydration Tracker</h2>
                    <div className="water-subtitle">Stay Hydrated!</div>
                </div>
                <div className="water-header-actions" style={{ gap: '0.5rem' }}>
                    <button className="goal-btn" onClick={() => { setNewGoal(waterGoal); setShowGoalInput(true); }}>
                        Target: {waterGoal}mL
                    </button>
                    <button className="history-btn" onClick={() => setShowHistoryModal(true)}>
                        Show History
                    </button>
                </div>
            </div>

            {/* Goal Input Modal/Overlay */}
            {showGoalInput && createPortal(
                <div className="goal-input-overlay" onClick={() => setShowGoalInput(false)}>
                    <div className="goal-input-card" onClick={e => e.stopPropagation()}>
                        <h3>Set Daily Goal</h3>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                            <input
                                type="number"
                                value={newGoal}
                                onChange={e => setNewGoal(e.target.value)}
                                autoFocus
                            />
                            <span style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#395aff' }}>mL</span>
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
                            <button className="cancel-btn" onClick={() => setShowGoalInput(false)}>Cancel</button>
                            <button className="save-btn" onClick={saveGoal}>Save</button>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            <div className="water-card-body">

                {/* Custom HTML Liquid Chart */}
                <div className="water-html-chart-container">
                    {/* Y-Axis */}
                    <div className="water-y-axis">
                        <span style={{ bottom: '100%' }}>{waterGoal}mL</span>
                        <span style={{ bottom: '75%' }}>{Math.round(waterGoal * 0.75)}</span>
                        <span style={{ bottom: '50%' }}>{Math.round(waterGoal * 0.5)}</span>
                        <span style={{ bottom: '25%' }}>{Math.round(waterGoal * 0.25)}</span>
                        <span style={{ bottom: '0%' }}>0</span>
                    </div>

                    <div className="water-html-chart">
                        {weeklyChartData.map((d, i) => {
                            const isToday = d.isToday;
                            // Calculate percentage of goal, capped at 100 for visual sanity
                            const percentage = Math.min((d.raw / waterGoal) * 100, 100);

                            return (
                                <div key={i} className="water-column">
                                    <div className={`water-bar-track ${isToday ? 'today-track' : ''}`}>
                                        <div
                                            className={`water-bar-fill ${isToday ? 'liquid-fill' : 'solid-fill'} ${isToday && isSurging ? 'surging' : ''}`}
                                            style={{ height: `${percentage}%` }}
                                        >
                                            {isToday && (
                                                <>
                                                    <div className="liquid-wave"></div>
                                                    <div className="water-bubble b1"></div>
                                                    <div className="water-bubble b2"></div>
                                                    <div className="water-bubble b3"></div>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                    <span className={`water-day-label ${isToday ? 'active-day' : ''}`}>{d.day}</span>
                                    {/* Removed redundant tag if we have axis, or keep it? User asked for axis. Tag is nice for exact value on today. Keeping it. */}
                                    {isToday && <div className="today-val-tag">{d.raw}mL</div>}
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* 3. Footer Actions */}
                <div className="water-controls-footer">
                    <button className="water-btn remove" onClick={() => updateWater(-250)}>- 250mL</button>
                    <button className="water-btn" onClick={() => updateWater(250)}>+ 250mL</button>
                    <button className="water-btn" onClick={() => updateWater(500)}>+ 500mL</button>
                    <button className="water-btn" onClick={() => updateWater(1000)}>+ 1L</button>
                </div>
            </div>

            {/* HISTORY MODAL (Same logic as Sleep) */}
            {showHistoryModal && createPortal(
                <div className="water-modal-overlay" onClick={() => { setShowHistoryModal(false); setShowFullHistory(false); }}>
                    <div className="water-modal" onClick={e => e.stopPropagation()}>
                        <div className="water-modal-header">
                            <h3>Hydration History</h3>
                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                {!isEntryMode && (
                                    <button
                                        className="icon-btn"
                                        onClick={() => {
                                            setIsEntryMode(true);
                                            setEditingId(null);
                                            setManualDate(formatDateKey(new Date()));
                                            setManualAmount('');
                                        }}
                                        style={{ fontSize: '0.9rem', fontWeight: 600, color: '#395aff' }}
                                    >
                                        + Add Log
                                    </button>
                                )}
                                <button className="close-btn" onClick={() => { setShowHistoryModal(false); setShowFullHistory(false); }}>×</button>
                            </div>
                        </div>

                        <div className="water-modal-body">
                            {isEntryMode ? (
                                <div className="manual-entry-form" style={{ padding: '0 0.5rem' }}>
                                    <h4 style={{ marginTop: 0, marginBottom: '1rem' }}>{editingId ? 'Edit Water Log' : 'New Water Log'}</h4>
                                    <div className="form-group">
                                        <label>Date</label>
                                        <input
                                            type="date"
                                            value={manualDate}
                                            onChange={(e) => setManualDate(e.target.value)}
                                            disabled={!!editingId} // Disable date editing if updating existing record to avoid dupes/confusion? Or allow it? 
                                        // Ideally if they change date, it creates a new doc. Simpler to lock date for edit, or allow "Add" effectively.
                                        // Let's allow changing date but treating it as "write to that date".
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label>Amount (mL)</label>
                                        <input
                                            type="number"
                                            value={manualAmount}
                                            onChange={(e) => setManualAmount(e.target.value)}
                                            placeholder="e.g. 2500"
                                            autoFocus
                                        />
                                    </div>
                                    <div className="form-actions">
                                        <button className="cancel-btn" onClick={() => setIsEntryMode(false)}>Cancel</button>
                                        <button className="save-btn" onClick={handleSaveManual}>Save</button>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <div className="water-history-list">
                                        {hydrationHistory.length === 0 ? (
                                            <p className="empty-msg">No hydration logs found.</p>
                                        ) : (
                                            hydrationHistory.map(item => (
                                                <div key={item.id} className="history-item">
                                                    <div className="history-info">
                                                        <div className="history-date">
                                                            {new Date(item.dateKey + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                                                        </div>
                                                    </div>
                                                    <div className="history-right">
                                                        <span className="history-duration">{item.amount} mL</span>
                                                        <button className="icon-btn edit" onClick={() => handleEdit(item)}>✏️</button>
                                                        <button className="icon-btn delete" onClick={() => handleDelete(item.id)}>🗑️</button>
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                    </div>

                                    {/* Heatmap Footer */}
                                    <div className="profile-heatmap-wrapper water-heatmap">
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                                            <div className="profile-heatmap__title">Recent Hydration</div>
                                            <button className="view-full-btn" onClick={() => setShowFullHistory(true)}>View Full History →</button>
                                        </div>
                                        <div className="profile-heatmap">
                                            <div className="profile-heatmap__months-row">
                                                <span className="profile-heatmap__month-spacer" />
                                                <div className="profile-heatmap__months">
                                                    {getMonthLabels(recentWeeks).map(({ label, key }) => (
                                                        <span key={key} className={`profile-heatmap__month-label${label ? ' profile-heatmap__month-label--visible' : ''}`}>{label}</span>
                                                    ))}
                                                </div>
                                            </div>
                                            <div className="profile-heatmap__body">
                                                <div className="profile-heatmap__day-labels">
                                                    {DAY_LABELS.map(label => <span key={label}>{label}</span>)}
                                                </div>
                                                <div className="profile-heatmap__weeks">
                                                    {recentWeeks.map((week, index) => (
                                                        <div className="profile-heatmap__week" key={`week-${index}`}>
                                                            {week.map(day => (
                                                                <span key={day.key} className={`profile-heatmap__day ${getLevelClass(day.count)}`} title={`${day.key}: ${day.count}mL`} />
                                                            ))}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* FULL HISTORY OVERLAY */}
            {showFullHistory && createPortal(
                <div className="water-modal-overlay full-history" onClick={() => setShowFullHistory(false)}>
                    <div className="water-modal large" onClick={e => e.stopPropagation()}>
                        <div className="water-modal-header">
                            <h3>Complete Hydration History</h3>
                            <button className="close-btn" onClick={() => setShowFullHistory(false)}>×</button>
                        </div>
                        <div className="water-modal-body full-width">
                            {allYearsWeeks.map(yearData => (
                                <div key={yearData.year} style={{ marginBottom: '2.5rem' }}>
                                    <h4 style={{ margin: '0 0 1rem 0' }}>{yearData.year}</h4>
                                    <div className="profile-heatmap-wrapper water-heatmap">
                                        <div className="profile-heatmap">
                                            <div className="profile-heatmap__months-row">
                                                <span className="profile-heatmap__month-spacer" />
                                                <div className="profile-heatmap__months">
                                                    {getMonthLabels(yearData.weeks, yearData.year).map(({ label, key }) => (
                                                        <span key={key} className={`profile-heatmap__month-label${label ? ' profile-heatmap__month-label--visible' : ''}`}>{label}</span>
                                                    ))}
                                                </div>
                                            </div>
                                            <div className="profile-heatmap__body">
                                                <div className="profile-heatmap__day-labels">
                                                    {DAY_LABELS.map(label => <span key={label}>{label}</span>)}
                                                </div>
                                                <div className="profile-heatmap__weeks">
                                                    {yearData.weeks.map((week, index) => (
                                                        <div className="profile-heatmap__week" key={`week-${index}`}>
                                                            {week.map(day => (
                                                                <span key={day.key} className={`profile-heatmap__day ${getLevelClass(day.count)}`} title={`${day.key}: ${day.count}mL`} />
                                                            ))}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
};

export default HydrationTracker;
