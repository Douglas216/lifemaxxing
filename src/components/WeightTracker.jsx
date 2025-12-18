import React, { useState, useEffect, useMemo } from 'react';
import {
    collection,
    query,
    orderBy,
    onSnapshot,
    setDoc,
    doc,
    serverTimestamp
} from 'firebase/firestore';
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer
} from 'recharts';
import { useAuth } from '../context/AuthContext';
import { db } from '../firebase';
import './WeightTracker.css';

const TIME_RANGES = {
    WEEK: '1W',
    MONTH: '1M',
    YEAR: '1Y',
    ALL: 'All'
};

const WeightTracker = () => {
    const { user } = useAuth();

    // State
    const [weightInput, setWeightInput] = useState('');
    const [unit, setUnit] = useState('kg'); // 'kg' or 'lb'
    const [timeRange, setTimeRange] = useState(TIME_RANGES.MONTH);
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isEditingToday, setIsEditingToday] = useState(false);

    // Height State
    const [heightCm, setHeightCm] = useState(null); // stored in cm
    const [showHeightModal, setShowHeightModal] = useState(false);
    const [heightInput, setHeightInput] = useState('');
    const [heightUnit, setHeightUnit] = useState('cm'); // 'cm' or 'ft'

    // Info Tooltip State
    const [showInfo, setShowInfo] = useState(false);

    // Load Data
    useEffect(() => {
        if (!user) return;

        // 1. Listen for Weight History
        const weightsRef = collection(db, 'users', user.uid, 'physical_form');
        const q = query(weightsRef, orderBy('dateKey', 'asc'));

        const unsubWeights = onSnapshot(q, (snapshot) => {
            const data = snapshot.docs.map(docSnap => {
                const d = docSnap.data();
                return {
                    id: docSnap.id,
                    dateKey: d.dateKey, // "YYYY-MM-DD"
                    weightKg: d.weightKg,
                    timestamp: d.timestamp,
                };
            });
            setHistory(data);
            setLoading(false);
        });

        // 2. Listen for User Height (stored in profile details)
        const profileRef = doc(db, 'users', user.uid, 'profile', 'details');
        const unsubProfile = onSnapshot(profileRef, (snap) => {
            if (snap.exists()) {
                const data = snap.data();
                if (data.heightCm) {
                    setHeightCm(data.heightCm);
                }
            }
        });

        return () => {
            unsubWeights();
            unsubProfile();
        };
    }, [user]);

    // Handle Height Update
    const handleSaveHeight = async (e) => {
        e.preventDefault();
        if (!heightInput) return;

        let cmValue = parseFloat(heightInput);
        if (isNaN(cmValue)) return;

        if (heightUnit === 'ft') {
            // parse feet/inches if needed, or simple decimal feet
            // For simplicity, assuming decimal feet input (e.g. 5.9)
            cmValue = cmValue * 30.48;
        }

        try {
            await setDoc(doc(db, 'users', user.uid, 'profile', 'details'), {
                heightCm: Math.round(cmValue)
            }, { merge: true });
            setShowHeightModal(false);
            setHeightInput('');
        } catch (error) {
            console.error("Failed to save height:", error);
        }
    };

    // Handle Input
    const handleLogWeight = async (e) => {
        e.preventDefault();
        if (!weightInput || isNaN(parseFloat(weightInput))) return;

        let kgValue = parseFloat(weightInput);
        if (unit === 'lb') {
            kgValue = kgValue * 0.453592;
        }

        // Round to 2 decimals
        kgValue = Math.round(kgValue * 100) / 100;

        const todayDate = new Date();
        // Use local date string YYYY-MM-DD for key
        const year = todayDate.getFullYear();
        const month = String(todayDate.getMonth() + 1).padStart(2, '0');
        const day = String(todayDate.getDate()).padStart(2, '0');
        const todayKey = `${year}-${month}-${day}`;

        // Optimistic Save
        try {
            const docRef = doc(db, 'users', user.uid, 'physical_form', todayKey);
            await setDoc(docRef, {
                dateKey: todayKey,
                weightKg: kgValue,
                timestamp: serverTimestamp()
            }, { merge: true });

            setWeightInput('');
            setIsEditingToday(false);
        } catch (error) {
            console.error("Failed to save weight:", error);
        }
    };

    // Convert for Display
    const displayHistory = useMemo(() => {
        // 1. Filter by Time Range
        const now = new Date();
        // Reset to end of day to include all of today's data regardless of time
        now.setHours(23, 59, 59, 999);

        let cutoff = new Date(0); // Epoch

        if (timeRange === TIME_RANGES.WEEK) {
            cutoff = new Date(now);
            cutoff.setDate(now.getDate() - 7);
        } else if (timeRange === TIME_RANGES.MONTH) {
            cutoff = new Date(now);
            cutoff.setDate(now.getDate() - 30);
        } else if (timeRange === TIME_RANGES.YEAR) {
            cutoff = new Date(now);
            cutoff.setDate(now.getDate() - 365);
        }

        const filtered = history.filter(entry => {
            // Parse date manually to avoid timezone offset issues (YYYY-MM-DD -> UTC midnight)
            const [y, m, d] = entry.dateKey.split('-').map(Number);
            const entryDate = new Date(y, m - 1, d);
            return entryDate >= cutoff;
        });

        // 2. Convert Units & Calc BMI
        return filtered.map(item => {
            let bmi = null;
            if (heightCm && heightCm > 0) {
                const heightM = heightCm / 100;
                bmi = (item.weightKg / (heightM * heightM)).toFixed(1);
            }

            // Create timestamp for proportional x-axis
            const [y, m, d] = item.dateKey.split('-').map(Number);
            const dateObj = new Date(y, m - 1, d);

            return {
                date: item.dateKey, // for reference
                timestamp: dateObj.getTime(), // for proportional X axis
                displayWeight: unit === 'kg'
                    ? item.weightKg
                    : Math.round((item.weightKg * 2.20462) * 10) / 10,
                originalKg: item.weightKg,
                bmi: bmi
            };
        });
    }, [history, timeRange, unit, heightCm]);

    // Today's latest value text
    const todayEntry = history.find(h => {
        const today = new Date();
        const y = today.getFullYear();
        const m = String(today.getMonth() + 1).padStart(2, '0');
        const d = String(today.getDate()).padStart(2, '0');
        return h.dateKey === `${y}-${m}-${d}`;
    });

    const currentWeightDisplay = todayEntry
        ? (unit === 'kg'
            ? `${todayEntry.weightKg} kg`
            : `${(todayEntry.weightKg * 2.20462).toFixed(1)} lb`)
        : '--';

    // Helper to format height for display
    const formatHeight = (cm) => {
        if (!cm) return 'Set Height';
        const feetTotal = cm / 30.48;
        const feet = Math.floor(feetTotal);
        const inches = Math.round((feetTotal - feet) * 12);
        return `${cm}cm (${feet}'${inches}")`
    };

    const chartTicks = useMemo(() => {
        if (!displayHistory || displayHistory.length === 0) return [];
        const timestamps = displayHistory.map(d => d.timestamp);
        const min = Math.min(...timestamps);
        const max = Math.max(...timestamps);
        const oneDay = 24 * 60 * 60 * 1000;
        const ticks = [];

        // Generate daily ticks from min to max
        let current = min;
        while (current <= max) {
            ticks.push(current);
            current += oneDay;
        }

        // If range is large (e.g. > 2 weeks), filter ticks to avoid overcrowding
        // This is a simple adaptive strategy
        if (ticks.length > 14) {
            const step = Math.ceil(ticks.length / 7);
            return ticks.filter((_, i) => i % step === 0);
        }
        return ticks;
    }, [displayHistory]);

    return (
        <div className="weight-tracker-card" style={{ position: 'relative' }}>
            <div className="weight-header">
                <div className="weight-title-group" style={{ display: 'block', textAlign: 'left', marginRight: 'auto', position: 'relative' }}>
                    <h2 style={{ margin: 0, textAlign: 'left', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        Weight Tracker
                        <span
                            style={{ cursor: 'help', color: '#9ca3af', position: 'relative', display: 'flex', alignItems: 'center' }}
                            onMouseEnter={() => setShowInfo(true)}
                            onMouseLeave={() => setShowInfo(false)}
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="10"></circle>
                                <line x1="12" y1="16" x2="12" y2="12"></line>
                                <line x1="12" y1="8" x2="12.01" y2="8"></line>
                            </svg>


                            {showInfo && (
                                <div style={{
                                    position: 'absolute',
                                    top: '28px',
                                    left: '-5px',
                                    width: '280px',
                                    backgroundColor: 'white',
                                    padding: '16px',
                                    borderRadius: '12px',
                                    boxShadow: '0 10px 40px rgba(0,0,0,0.15)',
                                    border: '1px solid #f3f4f6',
                                    fontSize: '0.85rem',
                                    fontWeight: 'normal',
                                    color: '#4b5563',
                                    zIndex: 50,
                                    lineHeight: '1.5',
                                    textAlign: 'left'
                                }}>
                                    <div style={{ position: 'absolute', top: '-6px', left: '10px', width: '12px', height: '12px', background: 'white', transform: 'rotate(45deg)', borderLeft: '1px solid #f3f4f6', borderTop: '1px solid #f3f4f6' }}></div>
                                    <strong style={{ display: 'block', marginBottom: '6px', color: '#111827', fontSize: '0.9rem' }}>Best practice:</strong>
                                    For the most consistent results, weigh yourself in the morning after using the bathroom, before eating or drinking, and with minimal clothing.
                                </div>
                            )}
                        </span>
                    </h2>
                    <span className="weight-subtitle" style={{ textAlign: 'left', display: 'block', width: '100%', marginTop: '4px' }}>
                        Remember: Weight is only a number.
                    </span>
                </div>

                {/* Height button moved to top-right */}
                <button
                    className="weight-goal-btn"
                    onClick={() => {
                        setHeightInput(heightCm ? (heightUnit === 'cm' ? heightCm : (heightCm / 30.48).toFixed(2)) : '');
                        setShowHeightModal(true);
                    }}
                >
                    {heightCm ? `Height: ${formatHeight(heightCm)}` : 'Set Height'}
                </button>
            </div>

            <div className="weight-chart-wrapper">
                {loading ? (
                    <div className="weight-empty-state">Loading history...</div>
                ) : displayHistory.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={displayHistory}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                            <XAxis
                                dataKey="timestamp"
                                type="number"
                                domain={['dataMin', 'dataMax']}
                                ticks={chartTicks}
                                tick={{ fontSize: 10, fill: '#aaa' }}
                                tickLine={false}
                                axisLine={false}
                                tickFormatter={(unixTime) => {
                                    const date = new Date(unixTime);
                                    return `${date.getMonth() + 1}/${date.getDate()}`;
                                }}
                            />
                            <YAxis
                                domain={['auto', 'auto']}
                                hide={false}
                                tick={{ fontSize: 10, fill: '#aaa' }}
                                tickLine={false}
                                axisLine={false}
                                width={30}
                            />
                            <Tooltip
                                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                                itemStyle={{ color: '#395aff', fontWeight: 600 }}
                                formatter={(value, name, props) => {
                                    if (name === 'displayWeight') return [`${value} ${unit}`, 'Weight'];
                                    return [value, name];
                                }}
                                labelFormatter={(label) => {
                                    const date = new Date(label);
                                    return date.toLocaleDateString();
                                }}
                                // Custom content needed to show BMI properly
                                content={({ active, payload, label }) => {
                                    if (active && payload && payload.length) {
                                        const data = payload[0].payload;
                                        // Use the explicit date string from data if available, or format label
                                        const dateStr = data.date
                                            ? new Date(data.timestamp).toLocaleDateString()
                                            : new Date(label).toLocaleDateString();

                                        return (
                                            <div style={{ background: '#fff', padding: '10px 14px', border: 'none', borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                                                <p style={{ margin: 0, fontSize: '0.85rem', color: '#666' }}>{dateStr}</p>
                                                <p style={{ margin: '4px 0 0', fontWeight: 600, color: '#395aff' }}>
                                                    {data.displayWeight} {unit}
                                                </p>
                                                {data.bmi && (
                                                    <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: '#10b981', fontWeight: 500 }}>
                                                        BMI: {data.bmi}
                                                    </p>
                                                )}
                                            </div>
                                        );
                                    }
                                    return null;
                                }}
                            />
                            <Line
                                type="monotone"
                                dataKey="displayWeight"
                                stroke="#395aff"
                                strokeWidth={3}
                                dot={{ r: 4, strokeWidth: 2, fill: '#fff', stroke: '#395aff' }}
                                activeDot={{ r: 6, strokeWidth: 0, fill: '#395aff' }}
                                animationDuration={500}
                            />
                        </LineChart>
                    </ResponsiveContainer>
                ) : (
                    <div className="weight-empty-state">No data for selected period.</div>
                )}
            </div>

            {/* Time Controls moved below chart */}
            <div className="weight-controls-top" style={{ justifyContent: 'center', marginBottom: '1.5rem' }}>
                {Object.values(TIME_RANGES).map(range => (
                    <button
                        key={range}
                        className={`weight-time-btn ${timeRange === range ? 'active' : ''}`}
                        onClick={() => setTimeRange(range)}
                        style={{ minWidth: '60px', textAlign: 'center' }}
                    >
                        {range}
                    </button>
                ))}
            </div>

            {/* Height Modal */}
            {
                showHeightModal && (
                    <div style={{
                        position: 'absolute',
                        top: 0, left: 0, right: 0, bottom: 0,
                        background: 'rgba(255,255,255,0.95)',
                        backdropFilter: 'blur(4px)',
                        zIndex: 10,
                        borderRadius: '24px',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '2rem'
                    }}>
                        <h3 style={{ marginTop: 0, color: '#1f2333' }}>Set Height</h3>
                        <p style={{ marginBottom: '1.5rem', fontSize: '0.9rem', color: '#666', textAlign: 'center' }}>
                            Used to calculate your BMI trend.
                        </p>
                        <form onSubmit={handleSaveHeight} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%', maxWidth: '240px' }}>
                            <div className="weight-input-wrapper">
                                <input
                                    type="number"
                                    step="0.01"
                                    className="weight-input-field"
                                    placeholder={heightUnit === 'cm' ? "e.g. 175" : "e.g. 5.9"}
                                    value={heightInput}
                                    onChange={(e) => setHeightInput(e.target.value)}
                                    autoFocus
                                />
                                <div className="weight-unit-toggle">
                                    <button
                                        type="button"
                                        className={`unit-btn ${heightUnit === 'cm' ? 'active' : ''}`}
                                        onClick={() => setHeightUnit('cm')}
                                    >
                                        cm
                                    </button>
                                    <button
                                        type="button"
                                        className={`unit-btn ${heightUnit === 'ft' ? 'active' : ''}`}
                                        onClick={() => setHeightUnit('ft')}
                                    >
                                        ft
                                    </button>
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <button type="button" className="weight-log-btn" style={{ background: '#f0f0f0', color: '#333', flex: 1 }} onClick={() => setShowHeightModal(false)}>Cancel</button>
                                <button type="submit" className="weight-log-btn" style={{ flex: 1 }}>Save</button>
                            </div>
                        </form>
                    </div>
                )
            }

            {
                todayEntry && !isEditingToday ? (
                    <div className="weight-input-section" style={{ justifyContent: 'space-between', borderTop: 'none', alignItems: 'center' }}>
                        <div style={{
                            color: '#395aff',
                            backgroundColor: 'rgba(57, 90, 255, 0.1)',
                            padding: '0.8rem 1rem',
                            borderRadius: '12px',
                            flex: 1,
                            marginRight: '1rem',
                            fontSize: '0.95rem',
                            fontWeight: '500',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}>
                            Weight logged today: <strong>&nbsp;{currentWeightDisplay}</strong>
                        </div>
                        <button
                            className="weight-log-btn"
                            style={{ background: 'transparent', color: '#395aff', border: '1px solid rgba(57, 90, 255, 0.3)', padding: '0 1rem' }}
                            onClick={() => {
                                setWeightInput(unit === 'kg' ? todayEntry.weightKg.toString() : (todayEntry.weightKg * 2.20462).toFixed(1));
                                setIsEditingToday(true);
                            }}
                        >
                            Edit
                        </button>
                    </div>
                ) : (
                    <form className="weight-input-section" onSubmit={handleLogWeight}>
                        <div className="weight-input-wrapper">
                            <input
                                type="number"
                                step="0.1"
                                className="weight-input-field"
                                placeholder="Log current weight..."
                                value={weightInput}
                                onChange={(e) => setWeightInput(e.target.value)}
                                autoFocus={isEditingToday}
                            />
                            <div className="weight-unit-toggle">
                                <button
                                    type="button"
                                    className={`unit-btn ${unit === 'kg' ? 'active' : ''}`}
                                    onClick={() => {
                                        if (unit !== 'kg') {
                                            setUnit('kg');
                                            if (weightInput) {
                                                const lbs = parseFloat(weightInput);
                                                if (!isNaN(lbs)) {
                                                    setWeightInput((lbs * 0.453592).toFixed(1));
                                                }
                                            }
                                        }
                                    }}
                                >
                                    kg
                                </button>
                                <button
                                    type="button"
                                    className={`unit-btn ${unit === 'lb' ? 'active' : ''}`}
                                    onClick={() => {
                                        if (unit !== 'lb') {
                                            setUnit('lb');
                                            if (weightInput) {
                                                const kgs = parseFloat(weightInput);
                                                if (!isNaN(kgs)) {
                                                    setWeightInput((kgs * 2.20462).toFixed(1));
                                                }
                                            }
                                        }
                                    }}
                                >
                                    lb
                                </button>
                            </div>
                        </div>
                        <button type="submit" className="weight-log-btn">
                            {isEditingToday ? 'Update' : 'Log Entry'}
                        </button>
                        {isEditingToday && (
                            <button
                                type="button"
                                className="weight-log-btn"
                                style={{ marginLeft: '0.5rem', background: 'transparent', color: '#666', border: '1px solid #ccc', padding: '0 1rem' }}
                                onClick={() => {
                                    setIsEditingToday(false);
                                    setWeightInput('');
                                }}
                            >
                                Cancel
                            </button>
                        )}
                    </form>
                )
            }
        </div >
    );
};

export default WeightTracker;
