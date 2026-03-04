import React, { useState, useEffect } from 'react';
import {
    onSnapshot,
    collection,
    query,
    where,
    setDoc,
    doc,
    deleteDoc,
    orderBy
} from 'firebase/firestore';
import {
    ResponsiveContainer,
    LineChart,
    Line,
    XAxis,
    YAxis,
    Tooltip
} from 'recharts';
import { useAuth } from '../context/AuthContext';
import { db } from '../firebase';
import './StrengthTracker.css';

import BenchIcon from '../assets/bench_press.svg';
import SquatIcon from '../assets/squat.svg';
import DeadliftIcon from '../assets/deadlift.svg.svg';

const StrengthTracker = () => {
    const { user } = useAuth();
    // const [loading, setLoading] = useState(true);
    const [unit, setUnit] = useState(() => localStorage.getItem('strength_unit') || 'kg'); // 'kg' or 'lb'
    const [timeRange, setTimeRange] = useState('ALL'); // '1W', '1M', '1Y', 'ALL'
    const [rmType, setRmType] = useState('1rm'); // '1rm', '5rm', '10rm', '20rm'

    // History Data for Graphs: { bench: [{date, weight}, ...], squat: [], ... }
    const [historyData, setHistoryData] = useState({ bench: [], squat: [], deadlift: [] });

    // Current Maxes (Cached or calculated from history)
    const [maxes, setMaxes] = useState({ bench: 0, squat: 0, deadlift: 0 });

    // Modal State
    const [showLogModal, setShowLogModal] = useState(false);
    const [showHistoryModal, setShowHistoryModal] = useState(false);
    const [logLift, setLogLift] = useState(null); // 'bench', 'squat', 'deadlift'
    const [logWeight, setLogWeight] = useState('');
    const [logDate, setLogDate] = useState(() => {
        const d = new Date();
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    });

    // Full History for History Modal
    const [fullHistory, setFullHistory] = useState([]);

    const [historyFilterLift, setHistoryFilterLift] = useState('ALL'); // 'ALL', 'bench', 'squat', 'deadlift'
    const [deleteId, setDeleteId] = useState(null); // ID to confirm delete

    // Persist Unit
    useEffect(() => {
        localStorage.setItem('strength_unit', unit);
    }, [unit]);

    // Fetch History for current RM Type
    useEffect(() => {
        if (!user) return;

        const historyRef = collection(db, 'users', user.uid, 'strength_history');
        const q = query(
            historyRef,
            where('rmType', '==', rmType)
        );

        const unsub = onSnapshot(q, (snapshot) => {
            // Group by date to deduplicate multiple entries per day
            const raw = { bench: {}, squat: {}, deadlift: {} };

            snapshot.docs.forEach(doc => {
                const d = doc.data();
                if (d.lift && raw[d.lift] !== undefined) {
                    // Create date string for grouping (YYYY-MM-DD)
                    const dateObj = d.date?.toDate() || new Date();
                    const y = dateObj.getFullYear();
                    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
                    const day = String(dateObj.getDate()).padStart(2, '0');
                    const dateKey = `${y}-${m}-${day}`;

                    const currentTs = dateObj.getTime();
                    const existing = raw[d.lift][dateKey];

                    // Keep the entry with the latest timestamp for that day
                    if (!existing || currentTs > existing.timestamp) {
                        raw[d.lift][dateKey] = {
                            timestamp: currentTs,
                            weight: d.weight,
                            id: doc.id
                        };
                    }
                }
            });

            // Convert back to sorted arrays
            const processed = { bench: [], squat: [], deadlift: [] };
            Object.keys(raw).forEach(lift => {
                processed[lift] = Object.values(raw[lift]).sort((a, b) => a.timestamp - b.timestamp);
            });

            setHistoryData(processed);

            // Calculate Maxes from history (All-time best for this RM)
            const newMaxes = {
                bench: Math.max(0, ...processed.bench.map(i => i.weight)),
                squat: Math.max(0, ...processed.squat.map(i => i.weight)),
                deadlift: Math.max(0, ...processed.deadlift.map(i => i.weight)),
            };
            setMaxes(newMaxes);
        });

        return () => unsub();

    }, [user, rmType]);

    // Fetch Full History when History Modal is Open
    useEffect(() => {
        if (!user || !showHistoryModal) return;

        const historyRef = collection(db, 'users', user.uid, 'strength_history');
        const q = query(
            historyRef,
            where('rmType', '==', rmType),
            orderBy('date', 'desc')
        );

        const unsub = onSnapshot(q, (snapshot) => {
            const data = snapshot.docs.map(doc => {
                const d = doc.data();
                return {
                    id: doc.id,
                    ...d,
                    // Safe date conversion
                    dateObj: d.date?.toDate ? d.date.toDate() : new Date(),
                    formattedDate: d.date?.toDate
                        ? d.date.toDate().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
                        : 'N/A'
                };
            });
            setFullHistory(data);
        });
        return () => unsub();
    }, [user, showHistoryModal, rmType]);

    // Filtered Data for Graphs based on timeRange
    const getFilteredHistory = (data) => {
        if (!data || data.length === 0) return [];
        if (timeRange === 'ALL') return data;

        const now = Date.now();
        let cutoff = 0;
        if (timeRange === '1W') cutoff = now - 7 * 24 * 60 * 60 * 1000;
        if (timeRange === '1M') cutoff = now - 30 * 24 * 60 * 60 * 1000;
        if (timeRange === '1Y') cutoff = now - 365 * 24 * 60 * 60 * 1000;

        return data.filter(d => d.timestamp >= cutoff);
    };

    // Handle Saving New PR - Enforce 1 per day
    const handleLogSave = async () => {
        if (!user || !logLift || !logWeight) return;

        let val = parseFloat(logWeight);
        if (isNaN(val) || val < 0) val = 0;

        // Convert to Kg if input was Lb
        let valKg = unit === 'kg' ? val : val / 2.20462;
        valKg = Math.round(valKg * 100) / 100;

        try {
            // Generate ID for today: lift_rmType_YYYY-MM-DD
            // Use logDate 
            const [y, m, d] = logDate.split('-');
            const sentDate = new Date(y, m - 1, d);
            // Ensure we set the time to noon to avoid timezone rolling issues with simple dates
            sentDate.setHours(12, 0, 0, 0);

            const dateKey = `${y}-${m}-${d}`;
            const docId = `${logLift}_${rmType}_${dateKey}`;

            // Use setDoc to overwrite if exists (enforces 1 per day)
            await setDoc(doc(db, 'users', user.uid, 'strength_history', docId), {
                lift: logLift,
                rmType: rmType,
                weight: valKg,
                date: sentDate, // Use the selected date
                dateKey: dateKey // Helpful for debugging/querying
            });

            setShowLogModal(false);
            setLogLift(null);
            setLogWeight('');
        } catch (err) {
            console.error("Error logging PR:", err);
        }
    };

    const openLogModal = (lift) => {
        setLogLift(lift);
        setLogWeight('');
        const d = new Date();
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        setLogDate(`${year}-${month}-${day}`); // Default to today (Local)
        setShowLogModal(true);
    };


    const confirmDelete = async () => {
        if (!deleteId) return;
        try {
            await deleteDoc(doc(db, 'users', user.uid, 'strength_history', deleteId));
            setDeleteId(null);
        } catch (e) {
            console.error("Delete failed", e);
        }
    };

    const handleEditHistory = (item) => {
        // Pre-fill log modal
        setRmType(item.rmType);
        setLogLift(item.lift);
        setLogWeight(unit === 'kg' ? item.weight : Math.round(item.weight * 2.20462 * 10) / 10);

        // Convert item date to YYYY-MM-DD for input
        if (item.dateObj) {
            const year = item.dateObj.getFullYear();
            const month = String(item.dateObj.getMonth() + 1).padStart(2, '0');
            const day = String(item.dateObj.getDate()).padStart(2, '0');
            setLogDate(`${year}-${month}-${day}`);
        }

        setShowHistoryModal(false); // Close history to show editor
        setShowLogModal(true);
    };

    const convert = (kg) => {
        const val = unit === 'kg' ? kg : kg * 2.20462;
        return parseFloat(val.toFixed(1));
    };

    const totalKg = (maxes.bench + maxes.squat + maxes.deadlift) || 0;
    const totalDisplay = convert(totalKg);

    const LIFT_CONFIG = [
        { key: 'bench', label: 'Bench Press', icon: <img src={BenchIcon} alt="Bench" style={{ width: '40px', height: '40px' }} /> },
        { key: 'squat', label: 'Squat', icon: <img src={SquatIcon} alt="Squat" style={{ width: '40px', height: '40px' }} /> },
        { key: 'deadlift', label: 'Deadlift', icon: <img src={DeadliftIcon} alt="Deadlift" style={{ width: '40px', height: '40px' }} /> }
    ];
    return (
        <div className="strength-tracker-container">
            <div className="top-bar">
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                        <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700 }}>PR Tracker</h2>
                    </div>
                    <div style={{ fontSize: '0.9rem', color: 'rgba(31, 35, 51, 0.6)', marginTop: '0.25rem' }}>
                        It's what you do in the dark that puts you in the light.
                    </div>
                </div>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                    <div className="rm-controls" style={{ display: 'flex', gap: '0.5rem' }}>
                        {['1rm', '5rm', '10rm', '20rm'].map(rm => (
                            <button
                                key={rm}
                                className={`rm-toggle-btn ${rmType === rm ? 'active' : ''}`}
                                onClick={() => setRmType(rm)}
                            >
                                {rm.toUpperCase()}
                            </button>
                        ))}
                    </div>
                    <button className="history-btn" onClick={() => setShowHistoryModal(true)}>
                        Show History
                    </button>
                </div>
            </div>

            <div className="strength-tracker-grid">
                {LIFT_CONFIG.map(({ key, label, icon }) => {
                    const filteredData = getFilteredHistory(historyData[key]);
                    // Transform data for the chart: convert weight to selected unit
                    const chartData = filteredData.map(d => ({
                        ...d,
                        displayWeight: convert(d.weight)
                    }));

                    // Use exact data points as ticks to ensure every log entry is labeled
                    const chartTicks = chartData.map(d => d.timestamp);

                    return (
                        <div key={key} className="lift-card">
                            <span className="lift-icon">{icon}</span>
                            <span className="lift-label">{label}</span>

                            <div
                                className="lift-value-display"
                                style={{ cursor: 'default', pointerEvents: 'none' }}
                            >
                                {maxes[key] > 0 ? convert(maxes[key]) : '--'}
                                <div className="unit-label">{maxes[key] > 0 ? unit : ''}</div>
                            </div>

                            <button className="log-pr-btn" onClick={() => openLogModal(key)}>
                                Log New PR
                            </button>

                            <div className="chart-container-expanded">
                                {chartData && chartData.length > 1 ? (
                                    <ResponsiveContainer width="100%" height="100%">
                                        <LineChart data={chartData}>
                                            <XAxis
                                                dataKey="timestamp"
                                                type="number"
                                                domain={['dataMin', 'dataMax']}
                                                tickFormatter={(ts) => new Date(ts).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })}
                                                tick={{ fontSize: 10, fill: '#aaa' }}
                                                tickLine={false}
                                                axisLine={false}
                                                interval="preserveStartEnd"
                                                ticks={chartTicks}
                                            />
                                            <YAxis
                                                domain={['auto', 'auto']}
                                                tick={{ fontSize: 10, fill: '#aaa' }}
                                                tickLine={false}
                                                axisLine={false}
                                                width={40}
                                                tickFormatter={(val) => Math.round(val)}
                                            />
                                            <Tooltip
                                                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                                                labelFormatter={(ts) => new Date(ts).toLocaleDateString()}
                                                formatter={(val) => [`${val} ${unit}`, 'Weight']}
                                            />
                                            <Line
                                                type="monotone"
                                                dataKey="displayWeight"
                                                stroke="#395aff"
                                                strokeWidth={3}
                                                dot={{ r: 4, fill: '#395aff', strokeWidth: 2, stroke: '#fff' }}
                                                activeDot={{ r: 6 }}
                                            />
                                        </LineChart>
                                    </ResponsiveContainer>
                                ) : (
                                    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.3, fontSize: '0.8em' }}>
                                        {chartData.length === 1 ? 'Log more to see trend' : 'No history'}
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div >

            <div className="strength-tracker-controls" style={{ position: 'relative' }}>
                <div className="time-range-controls">
                    {['1W', '1M', '1Y', 'ALL'].map(range => (
                        <button
                            key={range}
                            className={`time-range-btn ${timeRange === range ? 'active' : ''}`}
                            onClick={() => setTimeRange(range)}
                        >
                            {range}
                        </button>
                    ))}
                </div>
                <button
                    className="unit-toggle-btn"
                    onClick={() => setUnit(unit === 'kg' ? 'lb' : 'kg')}
                    style={{ position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)' }}
                >
                    Unit: {unit.toUpperCase()}
                </button>
            </div>

            <div className="strength-tracker-total">
                <span className="total-label">Big Three Total</span>
                <span className="total-value">{totalDisplay} <span style={{ fontSize: '0.9rem', fontWeight: 500, opacity: 0.6 }}>{unit}</span></span>
            </div>

            {/* LOG MODAL */}
            {
                showLogModal && (
                    <div className="strength-modal-overlay" onClick={() => setShowLogModal(false)}>
                        <div className="strength-modal" onClick={e => e.stopPropagation()}>
                            <h3>Log New {rmType.toUpperCase()} PR</h3>
                            <div style={{ textAlign: 'center', color: '#666', fontSize: '0.9rem' }}>
                                {LIFT_CONFIG.find(l => l.key === logLift)?.label}
                            </div>

                            <div className="lift-input-group">
                                <label style={{ fontSize: '0.8rem', color: '#666', fontWeight: 600 }}>Date</label>
                                <input
                                    type="date"
                                    className="lift-input"
                                    style={{ fontSize: '1rem', padding: '0.5rem' }}
                                    value={logDate}
                                    onChange={e => setLogDate(e.target.value)}
                                />
                                <label style={{ fontSize: '0.8rem', color: '#666', fontWeight: 600, marginTop: '0.5rem' }}>Weight ({unit})</label>
                                <input
                                    type="number"
                                    className="lift-input"
                                    value={logWeight}
                                    onChange={(e) => setLogWeight(e.target.value)}
                                    placeholder={`Enter weight in ${unit}`}
                                    autoFocus
                                />
                            </div>

                            <div className="strength-modal-actions">
                                <button className="strength-modal-btn cancel" onClick={() => setShowLogModal(false)}>Cancel</button>
                                <button className="strength-modal-btn save" onClick={handleLogSave}>Log Record</button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* HISTORY MODAL */}
            {
                showHistoryModal && (
                    <div className="strength-modal-overlay" onClick={() => setShowHistoryModal(false)}>
                        <div className="strength-modal"
                            style={{ maxWidth: '600px', maxHeight: '80vh', overflowY: 'hidden', padding: '1.5rem' }}
                            onClick={e => e.stopPropagation()}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                <h3 style={{ margin: 0 }}>{rmType.toUpperCase()} History Log</h3>
                                <button onClick={() => setShowHistoryModal(false)} style={{ background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer' }}>✖</button>
                            </div>

                            {/* Lift Filter */}
                            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', overflowX: 'auto', paddingBottom: '0.5rem' }}>
                                <button
                                    onClick={() => setHistoryFilterLift('ALL')}
                                    style={{
                                        padding: '0.4rem 0.8rem',
                                        borderRadius: '20px',
                                        border: historyFilterLift === 'ALL' ? 'none' : '1px solid #ddd',
                                        background: historyFilterLift === 'ALL' ? '#1f2333' : 'white',
                                        color: historyFilterLift === 'ALL' ? 'white' : '#666',
                                        cursor: 'pointer',
                                        fontSize: '0.85rem',
                                        fontWeight: 600,
                                        whiteSpace: 'nowrap'
                                    }}
                                >
                                    All Lifts
                                </button>
                                {LIFT_CONFIG.map(lift => (
                                    <button
                                        key={lift.key}
                                        onClick={() => setHistoryFilterLift(lift.key)}
                                        style={{
                                            padding: '0.4rem 0.8rem',
                                            borderRadius: '20px',
                                            border: historyFilterLift === lift.key ? 'none' : '1px solid #ddd',
                                            background: historyFilterLift === lift.key ? '#395aff' : 'white',
                                            color: historyFilterLift === lift.key ? 'white' : '#666',
                                            cursor: 'pointer',
                                            fontSize: '0.85rem',
                                            fontWeight: 600,
                                            whiteSpace: 'nowrap'
                                        }}
                                    >
                                        {lift.label}
                                    </button>
                                ))}
                                <div style={{ marginLeft: 'auto' }}>
                                    <button
                                        onClick={() => setUnit(unit === 'kg' ? 'lb' : 'kg')}
                                        style={{
                                            padding: '0.4rem 0.8rem',
                                            borderRadius: '20px',
                                            border: '1px solid #ddd',
                                            background: '#f9fafc',
                                            color: '#666',
                                            cursor: 'pointer',
                                            fontSize: '0.85rem',
                                            fontWeight: 600,
                                            whiteSpace: 'nowrap'
                                        }}
                                    >
                                        Unit: {unit.toUpperCase()}
                                    </button>
                                </div>
                            </div>

                            <div style={{ overflowY: 'auto', flex: 1 }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                                    <thead>
                                        <tr style={{ borderBottom: '2px solid #eee', textAlign: 'left', color: '#888' }}>
                                            <th style={{ padding: '0.5rem' }}>Date</th>
                                            <th style={{ padding: '0.5rem' }}>Lift</th>
                                            <th style={{ padding: '0.5rem' }}>Weight</th>
                                            <th style={{ padding: '0.5rem', textAlign: 'right' }}>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {fullHistory
                                            .filter(item => historyFilterLift === 'ALL' || item.lift === historyFilterLift)
                                            .map(item => (
                                                <tr key={item.id} style={{ borderBottom: '1px solid #f5f5f5' }}>
                                                    <td style={{ padding: '0.8rem 0.5rem', color: '#555' }}>
                                                        {item.formattedDate}
                                                    </td>
                                                    <td style={{ padding: '0.8rem 0.5rem', fontWeight: 600 }}>
                                                        {LIFT_CONFIG.find(l => l.key === item.lift)?.label || item.lift}
                                                    </td>
                                                    <td style={{ padding: '0.8rem 0.5rem', fontWeight: 700, color: '#395aff' }}>
                                                        {convert(item.weight)} {unit}
                                                    </td>
                                                    <td style={{ padding: '0.8rem 0.5rem', textAlign: 'right' }}>
                                                        <button
                                                            onClick={() => handleEditHistory(item)}
                                                            style={{ background: 'none', border: 'none', cursor: 'pointer', marginRight: '0.5rem', color: '#666' }}
                                                            title="Edit"
                                                        >
                                                            ✏️
                                                        </button>
                                                        <button
                                                            title="Edit"
                                                        >
                                                            ✏️
                                                        </button>
                                                        <button
                                                            onClick={() => setDeleteId(item.id)}
                                                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444' }}
                                                            title="Delete"
                                                        >
                                                            🗑️
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        {fullHistory.filter(item => historyFilterLift === 'ALL' || item.lift === historyFilterLift).length === 0 && (
                                            <tr>
                                                <td colSpan="4" style={{ textAlign: 'center', padding: '2rem', color: '#aaa' }}>
                                                    No history found.
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* DELETE CONFIRMATION MODAL */}
            {deleteId && (
                <div className="strength-modal-overlay" onClick={() => setDeleteId(null)}>
                    <div className="strength-modal" style={{ maxWidth: '300px', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                        <h3 style={{ marginTop: 0 }}>Delete Record?</h3>
                        <p style={{ color: '#666', marginBottom: '1.5rem' }}>Are you sure you want to remove this PR entry?</p>
                        <div className="strength-modal-actions">
                            <button className="strength-modal-btn cancel" onClick={() => setDeleteId(null)}>Cancel</button>
                            <button className="strength-modal-btn save" style={{ background: '#ef4444' }} onClick={confirmDelete}>Delete</button>
                        </div>
                    </div>
                </div>
            )}
        </div >
    );
};

export default StrengthTracker;
