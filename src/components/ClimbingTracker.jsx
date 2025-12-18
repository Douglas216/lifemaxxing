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
    Cell
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

    // Form State
    const [selectedGrade, setSelectedGrade] = useState('V3');
    const [logDate, setLogDate] = useState(getLocalToday());

    // Reset grade when type changes
    useEffect(() => {
        if (climbType === 'boulder') setSelectedGrade('V3');
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

        const currentGrades = climbType === 'boulder' ? V_GRADES : YDS_GRADES;
        // For YDS, only show 5.5+ on graph as requested (Now starts at 5.6 by default)
        const displayGrades = climbType === 'boulder' ? V_GRADES : YDS_GRADES;

        // Filter
        const filtered = climbs.filter(c => {
            // Backwards compatibility: if type is missing, it's boulder
            const cType = c.type || 'boulder';
            return cType === climbType && c.timestamp >= cutoff;
        });

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
                grade: selectedGrade,
                date: dateObj,
                createdAt: serverTimestamp()
            });
            setShowLogModal(false);
            // Reset to defaults
            setSelectedGrade('V3');
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
                    <span className="climb-subtitle">The only way is up.</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button
                        className="climb-type-toggle-btn"
                        onClick={cycleClimbType}
                        title="Click to switch climbing discipline"
                    >
                        {climbType === 'boulder' ? 'Bouldering' : climbType === 'top_rope' ? 'Top Rope' : 'Lead'}
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
            {showLogModal && createPortal(
                <div className="climb-modal-overlay" onClick={() => setShowLogModal(false)}>
                    <div className="climb-modal" onClick={e => e.stopPropagation()}>
                        <h3>Log Sent Climb</h3>

                        <div className="form-group">
                            <label>Grade</label>
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
            )}

            {/* HISTORY MODAL */}
            {showHistoryModal && createPortal(
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
                                                style={{ backgroundColor: getBarColor(climb.grade) }}
                                            >
                                                {climb.grade}
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
            )}
        </div>
    );
};

export default ClimbingTracker;
