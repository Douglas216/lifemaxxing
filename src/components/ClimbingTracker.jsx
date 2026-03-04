import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
    collection,
    query,
    orderBy,
    onSnapshot,
    addDoc,
    serverTimestamp,
    deleteDoc,
    doc
} from 'firebase/firestore';
import {
    ResponsiveContainer,
    BarChart,
    Bar,
    XAxis,
    YAxis,
    Tooltip,
    CartesianGrid,
    Cell,
    LineChart,
    Line
} from 'recharts';
import { useAuth } from '../context/AuthContext';
import { db } from '../firebase';
import './ClimbingTracker.css';

const V_GRADES = ['VB', 'V0', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8', 'V9', 'V10', 'V11', 'V12', 'V13', 'V14', 'V15', 'V16', 'V17'];
const YDS_GRADES = [
    '5.6', '5.7', '5.8', '5.9',
    '5.10a', '5.10b', '5.10c', '5.10d',
    '5.11a', '5.11b', '5.11c', '5.11d',
    '5.12a', '5.12b', '5.12c', '5.12d',
    '5.13a', '5.13b', '5.13c', '5.13d',
    '5.14a', '5.14b', '5.14c', '5.14d',
    '5.15a', '5.15b', '5.15c', '5.15d'
];

const getLocalToday = () => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const ClimbingTracker = () => {
    const { user } = useAuth();
    const [climbs, setClimbs] = useState([]);
    const [timeRange, setTimeRange] = useState('ALL'); // '1W', '1M', '1Y', 'ALL'
    const [climbType, setClimbType] = useState('boulder'); // 'boulder', 'top_rope', 'lead'
    const [showLogModal, setShowLogModal] = useState(false);
    const [showHistoryModal, setShowHistoryModal] = useState(false);
    const [showInfo, setShowInfo] = useState(false); // Info tooltip state

    // Form State
    const [selectedGrade, setSelectedGrade] = useState('V3');
    const [logDate, setLogDate] = useState(getLocalToday());
    const [logTime, setLogTime] = useState(''); // For Speed Climbing (seconds)

    // Reset grade when type changes
    useEffect(() => {
        if (climbType === 'boulder') setSelectedGrade('V3');
        else if (climbType === 'speed') setSelectedGrade(''); // No grade for speed
        else setSelectedGrade('5.10a');
    }, [climbType]);

    // Graph Color Helper
    // Graph Color Helper
    const getBarColor = (grade) => {
        if (climbType === 'boulder') {
            const index = V_GRADES.indexOf(grade);
            if (index < 3) return '#4ade80'; // Easy
            if (index < 6) return '#fbbf24'; // Moderate
            if (index < 9) return '#f87171'; // Hard
            return '#a855f7'; // Elite
        } else {
            // YDS Logic
            // YDS Logic
            // 5.6 - 5.9: Easy
            if (grade.startsWith('5.6') || grade.startsWith('5.7') || grade.startsWith('5.8') || grade.startsWith('5.9')) return '#4ade80';

            // 5.10 - 5.11: Moderate
            if (grade.startsWith('5.10') || grade.startsWith('5.11')) return '#fbbf24';

            // 5.12 - 5.13: Hard
            if (grade.startsWith('5.12') || grade.startsWith('5.13')) return '#f87171';

            // 5.14+: Elite
            return '#a855f7';
        }
    };

    // Fetch History
    useEffect(() => {
        if (!user) return;
        const q = query(
            collection(db, 'users', user.uid, 'climbing_history'),
            orderBy('date', 'desc')
        );

        const unsub = onSnapshot(q, (snapshot) => {
            const data = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                // Convert timestamp to Date object for easier filtering
                timestamp: doc.data().date?.toMillis() || Date.now()
            }));
            setClimbs(data);
        });

        return () => unsub();
    }, [user]);

    // Calculate Chart Data based on Time Range
    const chartData = React.useMemo(() => {
        const now = Date.now();
        let cutoff = 0;
        if (timeRange === '1W') cutoff = now - 7 * 24 * 60 * 60 * 1000;
        if (timeRange === '1M') cutoff = now - 30 * 24 * 60 * 60 * 1000;
        if (timeRange === '1Y') cutoff = now - 365 * 24 * 60 * 60 * 1000;

        // Filter by type and time range common logic
        const filtered = climbs.filter(c => {
            const cType = c.type || 'boulder';
            return cType === climbType && c.timestamp >= cutoff;
        });

        if (climbType === 'speed') {
            // Processing for Line Chart (Date vs Time)
            // We want to show the best time (lowest) for each day if there are multiple?
            // Or just show all? Strength tracker shows all or max.
            // Let's sort by date ascending
            const sorted = [...filtered].sort((a, b) => a.timestamp - b.timestamp);

            return sorted.map(c => ({
                id: c.id,
                timestamp: c.timestamp,
                dateStr: new Date(c.timestamp).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' }),
                time: parseFloat(c.time || 0)
            }));
        }

        const currentGrades = climbType === 'boulder' ? V_GRADES : YDS_GRADES;
        // For YDS, only show 5.5+ on graph as requested (Now starts at 5.6 by default)
        const displayGrades = climbType === 'boulder' ? V_GRADES : YDS_GRADES;

        // Aggregate
        const counts = {};
        currentGrades.forEach(g => counts[g] = 0);

        filtered.forEach(c => {
            if (counts[c.grade] !== undefined) {
                counts[c.grade]++;
            }
        });

        // Convert to array (Use displayGrades for X-Axis structure)
        return displayGrades.map(grade => ({
            grade,
            count: counts[grade] || 0
        })).filter(d => d.count > 0 || timeRange === 'ALL');
    }, [climbs, timeRange, climbType]);

    const cycleClimbType = () => {
        if (climbType === 'boulder') setClimbType('top_rope');
        else if (climbType === 'top_rope') setClimbType('lead');
        else if (climbType === 'lead') setClimbType('speed');
        else setClimbType('boulder');
    };

    const handleLogClimb = async () => {
        if (!user) return;
        try {
            // Create a proper date object from the input string (YYYY-MM-DD)
            // We set time to noon to avoid timezone rolling issues
            const [y, m, d] = logDate.split('-').map(Number);
            const dateObj = new Date(y, m - 1, d, 12, 0, 0, 0);

            await addDoc(collection(db, 'users', user.uid, 'climbing_history'), {
                type: climbType,
                grade: climbType === 'speed' ? null : selectedGrade,
                time: climbType === 'speed' ? parseFloat(logTime) : null,
                date: dateObj,
                createdAt: serverTimestamp()
            });
            setShowLogModal(false);
            // Reset to defaults
            setSelectedGrade('V3');
            setLogTime('');
            setLogDate(getLocalToday());
        } catch (error) {
            console.error("Error logging climb:", error);
        }
    };

    const handleDelete = async (id) => {
        if (!window.confirm("Delete this log?")) return;
        try {
            await deleteDoc(doc(db, 'users', user.uid, 'climbing_history', id));
        } catch (err) {
            console.error(err);
        }
    }

    return (
        <div className="climbing-tracker-container">
            <div className="top-bar">
                <div className="title-group">
                    <h2 style={{ margin: 0, fontSize: '1.4rem', color: '#1f2333' }}>Climbing Tracker</h2>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span className="climb-subtitle">The only way is up.</span>
                        <div
                            style={{ position: 'relative', display: 'flex', alignItems: 'center', cursor: 'help', color: '#9ca3af' }}
                            onMouseEnter={() => setShowInfo(true)}
                            onMouseLeave={() => setShowInfo(false)}
                        >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="10"></circle>
                                <line x1="12" y1="16" x2="12" y2="12"></line>
                                <line x1="12" y1="8" x2="12.01" y2="8"></line>
                            </svg>
                            {showInfo && createPortal(
                                <div
                                    style={{
                                        position: 'fixed',
                                        top: 0,
                                        left: 0,
                                        width: '100vw',
                                        height: '100vh',
                                        pointerEvents: 'none',
                                        zIndex: 9999
                                    }}
                                >
                                    <div style={{
                                        position: 'fixed',
                                        top: '50%',
                                        left: '50%',
                                        transform: 'translate(-50%, -50%)',
                                        background: 'white',
                                        color: '#4b5563',
                                        padding: '32px',
                                        borderRadius: '16px',
                                        border: '1px solid #f3f4f6',
                                        fontSize: '0.9rem',
                                        width: '650px',
                                        boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
                                        lineHeight: '1.6',
                                        textAlign: 'left',
                                        fontWeight: 'normal',
                                        pointerEvents: 'auto'
                                    }}>
                                        {climbType === 'boulder' ? (
                                            <div style={{ display: 'flex', gap: '32px', alignItems: 'center' }}>
                                                <div style={{ flex: 1 }}>
                                                    <strong style={{ color: '#1f2333', fontSize: '1.1rem', display: 'block', marginBottom: '8px' }}>V Scale</strong>
                                                    <p style={{ margin: 0, opacity: 0.9 }}>
                                                        The <strong>V</strong> scale, also known as the <strong>Hueco</strong> scale, originated in the late 1980s and early 1990s at <strong>Hueco Tanks</strong> State Park, Texas, where American climbing pioneer John Sherman, nicknamed “<strong>the Verm</strong>,” introduced a bouldering-specific grading system at a time when climbing difficulty was largely defined by roped climbing grades, and bouldering was often treated primarily as training for harder roped routes.
                                                    </p>
                                                </div>
                                                <div style={{ width: '298px', flexShrink: 0 }}>
                                                    <div style={{
                                                        height: '280px',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        position: 'relative'
                                                    }}>
                                                        <img
                                                            src={require('../assets/Blank_US_Map_(states_only).svg').default}
                                                            alt="Map showing Hueco Tanks with Texas highlighted"
                                                            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        ) : climbType === 'speed' ? (
                                            <div>
                                                <strong style={{ color: '#1f2333', fontSize: '1.1rem' }}>Speed Climbing</strong>
                                                <p style={{ marginTop: '8px' }}>
                                                    A race against the clock on a standardized 15m wall. The world record is under 5 seconds! Track your time in seconds.
                                                </p>
                                            </div>
                                        ) : (
                                            <div>
                                                <strong style={{ color: '#1f2333', fontSize: '1.1rem' }}>Yosemite Decimal System (YDS)</strong>
                                                <p style={{ marginTop: '8px' }}>
                                                    For roped climbing (Top Rope, Lead). Ranges from 5.0 to 5.15d.
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                </div>,
                                document.body
                            )}
                        </div>
                    </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button
                        className="climb-type-toggle-btn"
                        onClick={cycleClimbType}
                        title="Click to switch climbing discipline"
                    >
                        {climbType === 'boulder' ? 'Bouldering' : climbType === 'top_rope' ? 'Top Rope' : climbType === 'lead' ? 'Lead' : 'Speed'}
                    </button>
                    {/* Add small visual indicator arrows if desired, or keep simple */}
                </div>

                <button
                    className="climb-history-btn-top"
                    onClick={() => setShowHistoryModal(true)}
                >
                    Show History
                </button>
            </div>

            <div className="chart-area">
                <ResponsiveContainer width="100%" height="100%">
                    {climbType === 'speed' ? (
                        <LineChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eee" />
                            <XAxis
                                dataKey="timestamp"
                                type="number"
                                domain={['dataMin', 'dataMax']}
                                tickFormatter={(ts) => new Date(ts).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })}
                                tick={{ fontSize: 10, fill: '#aaa' }}
                                tickLine={false}
                                axisLine={false}
                                interval="preserveStartEnd"
                            />
                            <YAxis
                                domain={['auto', 'auto']}
                                tick={{ fontSize: 10, fill: '#aaa' }}
                                tickLine={false}
                                axisLine={false}
                                width={40}
                                tickFormatter={(val) => `${val}s`}
                            />
                            <Tooltip
                                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                                labelFormatter={(ts) => new Date(ts).toLocaleDateString()}
                                formatter={(val) => [`${val} s`, 'Time']}
                            />
                            <Line
                                type="monotone"
                                dataKey="time"
                                stroke="#f59e0b" // Ambient/Warning color like Speed
                                strokeWidth={3}
                                dot={{ r: 4, fill: '#f59e0b', strokeWidth: 2, stroke: '#fff' }}
                                activeDot={{ r: 6 }}
                            />
                        </LineChart>
                    ) : (
                        <BarChart data={chartData} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eee" />
                            <XAxis
                                dataKey="grade"
                                tickLine={false}
                                axisLine={{ stroke: '#eee' }}
                                tick={{ fontSize: 10, fill: '#666' }}
                                interval={timeRange === 'ALL' ? 'preserveStartEnd' : 0}
                                ticks={timeRange === 'ALL' ? (climbType === 'boulder'
                                    ? ['VB', 'V1', 'V3', 'V5', 'V7', 'V9', 'V11', 'V13', 'V15', 'V17']
                                    : ['5.6', '5.8', '5.10a', '5.11a', '5.12a', '5.13a', '5.14a', '5.15a', '5.15d']) : undefined}
                            />
                            <YAxis
                                allowDecimals={false}
                                tickLine={false}
                                axisLine={false}
                                tick={{ fontSize: 12, fill: '#aaa' }}
                            />
                            <Tooltip
                                cursor={{ fill: '#f4f4f5' }}
                                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                            />
                            <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                                {chartData.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={getBarColor(entry.grade)} />
                                ))}
                            </Bar>
                        </BarChart>
                    )}
                </ResponsiveContainer>
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.5rem' }}>
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
            </div>

            <div className="climb-actions-bottom">
                <button className="log-climb-btn full-width" onClick={() => setShowLogModal(true)}>
                    + Log Climb
                </button>
            </div>

            {/* LOG MODAL */}
            {
                showLogModal && createPortal(
                    <div className="climb-modal-overlay" onClick={() => setShowLogModal(false)}>
                        <div className="climb-modal" onClick={e => e.stopPropagation()}>
                            <h3>Log Sent Climb</h3>

                            <div className="form-group">
                                <label>{climbType === 'speed' ? 'Time (seconds)' : 'Grade'}</label>
                                {climbType === 'speed' ? (
                                    <input
                                        type="number"
                                        placeholder="e.g. 15.4"
                                        value={logTime}
                                        onChange={(e) => setLogTime(e.target.value)}
                                        className="climb-date-input" // Reuse style class for consistency
                                        autoFocus
                                        step="0.01"
                                    />
                                ) : (
                                    <div className="grade-grid">
                                        {(climbType === 'boulder' ? V_GRADES : YDS_GRADES).map(g => (
                                            <button
                                                key={g}
                                                className={`grade-select-btn ${selectedGrade === g ? 'selected' : ''}`}
                                                onClick={() => setSelectedGrade(g)}
                                                style={{
                                                    borderColor: selectedGrade === g ? getBarColor(g) : 'transparent',
                                                    backgroundColor: selectedGrade === g ? `${getBarColor(g)}20` : '#f5f5f5',
                                                    color: selectedGrade === g ? getBarColor(g) : '#333'
                                                }}
                                            >
                                                {g}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className="form-group">
                                <label>Date Sent</label>
                                <input
                                    type="date"
                                    value={logDate}
                                    onChange={(e) => setLogDate(e.target.value)}
                                    className="climb-date-input"
                                />
                            </div>

                            <div className="modal-actions">
                                <button className="cancel-btn" onClick={() => setShowLogModal(false)}>Cancel</button>
                                <button className="save-btn" onClick={handleLogClimb}>Log It!</button>
                            </div>
                        </div>
                    </div>,
                    document.body
                )
            }

            {/* HISTORY MODAL */}
            {
                showHistoryModal && createPortal(
                    <div className="climb-modal-overlay" onClick={() => setShowHistoryModal(false)}>
                        <div className="climb-modal history-modal-content" onClick={e => e.stopPropagation()}>
                            <div className="history-header">
                                <h3>Climb History</h3>
                                <button className="close-icon" onClick={() => setShowHistoryModal(false)}>✕</button>
                            </div>

                            <div className="history-list">
                                {climbs.length === 0 ? (
                                    <p className="empty-message">No climbs logged yet. Go send some rocks!</p>
                                ) : (
                                    climbs.filter(c => (c.type || 'boulder') === climbType).map(climb => (
                                        <div key={climb.id} className="history-item">
                                            <div className="history-info">
                                                <span
                                                    className="history-grade"
                                                    style={{ backgroundColor: climbType === 'speed' ? '#f59e0b' : getBarColor(climb.grade) }}
                                                >
                                                    {climbType === 'speed' ? `${climb.time}s` : climb.grade}
                                                </span>
                                                <span className="history-date">
                                                    {new Date(climb.timestamp).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                                                </span>
                                            </div>
                                            <button className="delete-log-btn" onClick={() => handleDelete(climb.id)}>
                                                Delete
                                            </button>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>,
                    document.body
                )
            }
        </div >
    );
};

export default ClimbingTracker;
