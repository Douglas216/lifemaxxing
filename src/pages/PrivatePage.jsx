import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Navigate, useNavigate } from 'react-router-dom';
import { ADMIN_EMAILS } from '../constants';
import NancyNavbar from '../components/NancyNavbar';
import { db } from '../firebase';
import { collection, query, orderBy, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';
import { useNancyTheme } from '../context/NancyThemeContext';

const TimerBlock = ({ value, label }) => (
    <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#fff',
        padding: '1.5rem 1rem',
        borderRadius: '24px',
        boxShadow: '0 8px 25px rgba(236, 72, 153, 0.2)',
        width: '130px',
        height: '150px',
        border: '2px solid rgba(255, 240, 245, 0.8)'
    }}>
        <span style={{ fontSize: '3.5rem', fontWeight: '800', color: '#be185d', lineHeight: 1, letterSpacing: '-2px' }}>
            {String(value).padStart(2, '0')}
        </span>
        <span style={{ fontSize: '0.9rem', color: '#be185d', opacity: 0.8, marginTop: '0.5rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '1px' }}>
            {label}
        </span>
    </div>
);

const TimerDisplay = ({ timer }) => {
    const [time, setTime] = useState({ years: 0, months: 0, days: 0, hours: 0, minutes: 0, seconds: 0 });
    const isCountUp = timer.type !== 'countdown'; // Default to count up (since)

    useEffect(() => {
        const targetDate = new Date(timer.date);

        const updateTimer = () => {
            const now = new Date();
            let diff = isCountUp ? (now - targetDate) : (targetDate - now);

            // If countdown finished
            if (diff < 0 && !isCountUp) {
                setTime({ years: 0, months: 0, days: 0, hours: 0, minutes: 0, seconds: 0 });
                return;
            }

            // Calculations
            // Note: Accurate Month/Year calc is tricky with plain milliseconds.
            // Reusing the previous logic for Count Up which was decent for "Since"

            let years = 0, months = 0, days = 0, hours = 0, minutes = 0, seconds = 0;

            if (isCountUp) {
                years = now.getFullYear() - targetDate.getFullYear();
                months = now.getMonth() - targetDate.getMonth();
                days = now.getDate() - targetDate.getDate();
                hours = now.getHours() - targetDate.getHours();
                minutes = now.getMinutes() - targetDate.getMinutes();
                seconds = now.getSeconds() - targetDate.getSeconds();

                if (seconds < 0) { seconds += 60; minutes--; }
                if (minutes < 0) { minutes += 60; hours--; }
                if (hours < 0) { hours += 24; days--; }
                if (days < 0) {
                    const prevMonth = new Date(now.getFullYear(), now.getMonth(), 0);
                    days += prevMonth.getDate();
                    months--;
                }
                if (months < 0) { months += 12; years--; }
            } else {
                // Countdown Logic (simplified for robustness)
                const totalSeconds = Math.floor(diff / 1000);
                days = Math.floor(totalSeconds / (3600 * 24));
                hours = Math.floor((totalSeconds % (3600 * 24)) / 3600);
                minutes = Math.floor((totalSeconds % 3600) / 60);
                seconds = totalSeconds % 60;

                // Approximate months/years for countdown if > 30 days?
                // For simplicity and accuracy in countdowns, usually Days is best. 
                // But user asked for "years/months" style.
                // Let's stick to Days/Hours/Mins/Secs for Countdown to avoid "varying month length" ambiguity in future dates.
                // OR adapt the count-up logic in reverse.
                // Let's us Days for now as it is standard for "Countdown".
            }

            setTime({ years, months, days, hours, minutes, seconds });
        };

        updateTimer();
        const interval = setInterval(updateTimer, 1000);
        return () => clearInterval(interval);
    }, [timer.date, isCountUp]);

    return (
        <div style={{ marginTop: '3rem', marginBottom: '1rem', width: '100%' }}>
            <h2 style={{
                color: '#9d174d',
                fontSize: '1.5rem',
                marginBottom: '1.5rem',
                fontWeight: '700',
                textTransform: 'uppercase',
                letterSpacing: '0.05em'
            }}>
                {timer.title}
            </h2>
            <div style={{
                display: 'flex',
                gap: '0.8rem',
                flexWrap: 'wrap',
                justifyContent: 'center',
                maxWidth: '100%'
            }}>
                {isCountUp ? (
                    <>
                        <TimerBlock value={time.years} label="Years" />
                        <TimerBlock value={time.months} label="Months" />
                        <TimerBlock value={time.days} label="Days" />
                        <TimerBlock value={time.hours} label="Hours" />
                        <TimerBlock value={time.minutes} label="Minutes" />
                        <TimerBlock value={time.seconds} label="Seconds" />
                    </>
                ) : (
                    <>
                        <TimerBlock value={time.days} label="Days" />
                        <TimerBlock value={time.hours} label="Hours" />
                        <TimerBlock value={time.minutes} label="Minutes" />
                        <TimerBlock value={time.seconds} label="Seconds" />
                    </>
                )}
            </div>
            {timer.type === 'countdown' && (
                <p style={{ marginTop: '1rem', color: '#be185d', fontWeight: '500' }}>Until {new Date(timer.date).toLocaleDateString()}</p>
            )}
        </div>
    );
};

const PrivatePage = () => {
    const { user, loading } = useAuth();
    const navigate = useNavigate();
    const { currentBg } = useNancyTheme();

    // Timer State
    const [timers, setTimers] = useState([]);
    const [isManaging, setIsManaging] = useState(false);
    const [newTimer, setNewTimer] = useState({ title: '', date: '', type: 'countup' });
    const [editingTimerId, setEditingTimerId] = useState(null);

    // Fetch Timers
    useEffect(() => {
        if (!user) return;
        // Fallback to createdAt if order is missing (for legacy items)
        const q = query(collection(db, 'users', user.uid, 'nancy_timers'), orderBy('order', 'asc'));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const fetchedTimers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            // Handle legacy items with no order (put them at end)
            fetchedTimers.sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999));
            setTimers(fetchedTimers);
        });
        return () => unsubscribe();
    }, [user]);

    const handleAddTimer = async (e) => {
        e.preventDefault();
        if (!newTimer.title || !newTimer.date) return;
        try {
            if (editingTimerId) {
                await updateDoc(doc(db, 'users', user.uid, 'nancy_timers', editingTimerId), {
                    ...newTimer,
                    updatedAt: serverTimestamp()
                });
            } else {
                await addDoc(collection(db, 'users', user.uid, 'nancy_timers'), {
                    ...newTimer,
                    createdAt: serverTimestamp(),
                    order: timers.length // Add at the end
                });
            }
            setNewTimer({ title: '', date: '', type: 'countup' });
            setEditingTimerId(null);
        } catch (error) {
            alert(error.message);
        }
    };

    const handleDeleteTimer = async (id) => {
        if (window.confirm('Delete this timer?')) {
            await deleteDoc(doc(db, 'users', user.uid, 'nancy_timers', id));
        }
    };

    // Drag and Drop Handlers
    const [draggedItemIndex, setDraggedItemIndex] = useState(null);

    const handleDragStart = (index) => {
        setDraggedItemIndex(index);
    };

    const handleDragOver = (e) => {
        e.preventDefault(); // Necessary to allow dropping
    };

    const handleDrop = async (index) => {
        if (draggedItemIndex === null || draggedItemIndex === index) return;

        const updatedTimers = [...timers];
        const [draggedItem] = updatedTimers.splice(draggedItemIndex, 1);
        updatedTimers.splice(index, 0, draggedItem);

        // Optimistic UI update
        setTimers(updatedTimers);
        setDraggedItemIndex(null);

        // Update Sorting in Firestore
        // We update specific doc IDs with their new index
        // To avoid too many writes, only update if necessary? No, easiest is just loop all.
        // Or loop only indices that changed.
        // For simplicity with small lists: Update all 'order' fields.
        try {
            const updates = updatedTimers.map((timer, idx) =>
                updateDoc(doc(db, 'users', user.uid, 'nancy_timers', timer.id), { order: idx })
            );
            await Promise.all(updates);
        } catch (error) {
            console.error("Error reordering:", error);
        }
    };

    if (loading) {
        return <div style={{ padding: '2rem', textAlign: 'center' }}>Loading...</div>;
    }

    if (!user) {
        return <Navigate to="/login" replace />;
    }

    const isAuthorized = ADMIN_EMAILS.includes(user.email);

    if (!isAuthorized) {
        return (
            <div style={{
                padding: '4rem',
                textAlign: 'center',
                color: '#ef4444',
                maxWidth: '600px',
                margin: '0 auto'
            }}>
                <h1>🛑 Access Denied</h1>
                <p>Your account ({user.email}) is not authorized to view this page.</p>
                <p>This page is restricted to specific personnel.</p>
            </div>
        );
    }

    // Calculate total days for the top-right badge
    const startDatePure = new Date('2025-05-11T04:27:00');
    const today = new Date();
    const diffTime = today - startDatePure;
    const totalDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    return (
        <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            minHeight: '100%',
            background: currentBg, // Full Page Dynamic Tint
            padding: '4rem 1rem',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center'
        }}>
            <NancyNavbar />
            <button
                onClick={() => navigate('/profile')}
                style={{
                    position: 'absolute',
                    top: '2rem',
                    left: '2rem',
                    background: 'transparent',
                    border: 'none',
                    fontSize: '2rem',
                    cursor: 'pointer',
                    color: '#be185d',
                    transition: 'transform 0.2s',
                    padding: '0.5rem',
                    lineHeight: 1,
                    zIndex: 20
                }}
                onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.1)'}
                onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
                title="Back to Profile"
            >
                ←
            </button>

            <div
                onClick={() => navigate('/nancy/creative')}
                style={{
                    position: 'absolute',
                    top: '2rem',
                    right: '2rem',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.75rem 2rem',
                    background: 'white',
                    borderRadius: '50px',
                    boxShadow: '0 4px 15px rgba(236, 72, 153, 0.1)',
                    color: '#be185d',
                    fontWeight: '700',
                    fontSize: '1rem',
                    zIndex: 20,
                    cursor: 'pointer',
                    transition: 'transform 0.2s'
                }}
                onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.05)'}
                onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
            >
                <span>我们在一起 {totalDays}天啦～</span>
            </div>

            {/* Dictionary Link */}
            <div
                onClick={() => navigate('/nancy/dictionary')}
                style={{
                    position: 'absolute',
                    bottom: '2rem',
                    left: '2rem',
                    fontSize: '2.5rem',
                    cursor: 'pointer',
                    transition: 'transform 0.2s'
                }}
                onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.2)'}
                onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
                title="Our Dictionary"
            >
                📖
            </div>

            <div style={{ textAlign: 'center', marginBottom: '3rem', width: '100%' }}>
                <h1 style={{ color: '#db2777', fontSize: '3.5rem', marginBottom: '0.5rem', textShadow: '0 2px 10px rgba(219, 39, 119, 0.1)' }}>♡ nancy & doug ♡</h1>
                <p style={{ color: '#db2777', fontSize: '1.25rem', opacity: 0.9, fontWeight: '500' }}>🐱 My dearest girlfriend. My best friend. My love. 🐶</p>

                {/* Dynamic Timers List */}
                {timers.length === 0 ? (
                    <div style={{ marginTop: '3rem', padding: '2rem', background: 'white', borderRadius: '24px', opacity: 0.8 }}>
                        <p>No timers set yet. Click "Manage Timers" to add one! 👇</p>
                    </div>
                ) : (
                    timers.map(timer => (
                        <TimerDisplay key={timer.id} timer={timer} />
                    ))
                )}

                {/* Manage Timers Button - Bottom Right Fixed */}
                <button
                    onClick={() => {
                        setIsManaging(!isManaging);
                        setEditingTimerId(null);
                        setNewTimer({ title: '', date: '', type: 'countup' });
                    }}
                    style={{
                        position: 'fixed',
                        bottom: '2rem',
                        right: '2rem',
                        background: isManaging ? '#f3f4f6' : '#be185d',
                        color: isManaging ? '#374151' : 'white',
                        border: 'none',
                        padding: '0.75rem 1.5rem',
                        borderRadius: '50px',
                        fontWeight: '600',
                        cursor: 'pointer',
                        boxShadow: '0 4px 15px rgba(0,0,0,0.15)',
                        zIndex: 50,
                        transition: 'transform 0.2s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.05)'}
                    onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
                >
                    {isManaging ? 'Close Manager' : 'Manage Timers'}
                </button>

                {/* Management Window - Centered */}
                {isManaging && (
                    <>
                        {/* Backdrop */}
                        <div
                            onClick={() => setIsManaging(false)}
                            style={{
                                position: 'fixed',
                                top: 0,
                                left: 0,
                                width: '100%',
                                height: '100%',
                                background: 'rgba(0,0,0,0.3)',
                                zIndex: 55,
                                backdropFilter: 'blur(4px)'
                            }}
                        />
                        {/* Modal */}
                        <div style={{
                            position: 'fixed',
                            top: '50%',
                            left: '50%',
                            transform: 'translate(-50%, -50%)',
                            width: '90%',
                            maxWidth: '500px',
                            background: 'white',
                            padding: '2rem',
                            borderRadius: '24px',
                            boxShadow: '0 20px 50px rgba(0,0,0,0.2)',
                            textAlign: 'left',
                            zIndex: 60,
                            maxHeight: '85vh',
                            overflowY: 'auto'
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                                <h3 style={{ margin: 0, color: '#be185d', fontSize: '1.5rem' }}>{editingTimerId ? 'Edit Timer' : 'Timer Manager'}</h3>
                                <button onClick={() => setIsManaging(false)} style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', opacity: 0.5 }}>✖</button>
                            </div>

                            <form onSubmit={handleAddTimer} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                <div style={{ display: 'flex', gap: '0.5rem', flexDirection: 'column' }}>
                                    <label style={{ fontSize: '0.9rem', color: '#666', fontWeight: 'bold', marginLeft: '0.5rem' }}>Event</label>
                                    <input
                                        type="text"
                                        placeholder="e.g. Time Together"
                                        value={newTimer.title}
                                        onChange={e => setNewTimer({ ...newTimer, title: e.target.value })}
                                        required
                                        style={{ padding: '1rem', borderRadius: '12px', border: '1px solid #ddd', fontSize: '1rem' }}
                                    />
                                </div>
                                <div style={{ display: 'flex', gap: '0.5rem', flexDirection: 'column' }}>
                                    <label style={{ fontSize: '0.9rem', color: '#666', fontWeight: 'bold', marginLeft: '0.5rem' }}>Date & Time</label>
                                    <input
                                        type="datetime-local"
                                        value={newTimer.date}
                                        onChange={e => setNewTimer({ ...newTimer, date: e.target.value })}
                                        required
                                        style={{ padding: '1rem', borderRadius: '12px', border: '1px solid #ddd', fontSize: '1rem' }}
                                    />
                                    <label style={{ fontSize: '0.9rem', color: '#666', fontWeight: 'bold', marginLeft: '0.5rem', marginTop: '0.5rem' }}>Timer Type</label>
                                    <select
                                        value={newTimer.type}
                                        onChange={e => setNewTimer({ ...newTimer, type: e.target.value })}
                                        style={{ padding: '1rem', borderRadius: '12px', border: '1px solid #ddd', fontSize: '1rem' }}
                                    >
                                        <option value="countup">Count Up (Since)</option>
                                        <option value="countdown">Count Down (Until)</option>
                                    </select>
                                </div>
                                <button type="submit" style={{
                                    background: '#be185d',
                                    color: 'white',
                                    padding: '1rem',
                                    border: 'none',
                                    borderRadius: '12px',
                                    fontWeight: 'bold',
                                    cursor: 'pointer',
                                    marginTop: '0.5rem',
                                    fontSize: '1rem',
                                    boxShadow: '0 4px 10px rgba(190, 24, 93, 0.2)'
                                }}>
                                    {editingTimerId ? 'Update Timer' : 'Add Timer'}
                                </button>
                                {editingTimerId && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setEditingTimerId(null);
                                            setNewTimer({ title: '', date: '', type: 'countup' });
                                        }}
                                        style={{
                                            background: '#f3f4f6',
                                            color: '#374151',
                                            padding: '0.8rem',
                                            border: 'none',
                                            borderRadius: '12px',
                                            fontWeight: 'bold',
                                            cursor: 'pointer',
                                            fontSize: '0.9rem'
                                        }}
                                    >
                                        Cancel Edit
                                    </button>
                                )}
                            </form>

                            <h4 style={{ marginTop: '2rem', marginBottom: '1rem', color: '#374151', borderTop: '1px solid #eee', paddingTop: '1rem' }}>
                                Existing Timers <span style={{ fontSize: '0.8rem', fontWeight: 'normal', color: '#999' }}>(Drag to reorder)</span>
                            </h4>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                                {timers.map((timer, index) => (
                                    <div
                                        key={timer.id}
                                        draggable
                                        onDragStart={() => handleDragStart(index)}
                                        onDragOver={handleDragOver}
                                        onDrop={() => handleDrop(index)}
                                        style={{
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center',
                                            padding: '1rem',
                                            background: '#fdf2f8',
                                            borderRadius: '16px',
                                            border: '1px solid #fbcfe8',
                                            cursor: 'grab',
                                            transition: 'transform 0.2s, box-shadow 0.2s',
                                            opacity: draggedItemIndex === index ? 0.5 : 1
                                        }}
                                    >
                                        <div>
                                            <div style={{ fontWeight: 'bold', color: '#be185d' }}>{timer.title}</div>
                                            <div style={{ fontSize: '0.85rem', color: '#888', marginTop: '0.2rem' }}>
                                                {timer.type === 'countdown' ? 'Ends' : 'Started'}: {new Date(timer.date).toLocaleDateString()}
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                                            <button
                                                onClick={() => {
                                                    setEditingTimerId(timer.id);
                                                    setNewTimer({ title: timer.title, date: timer.date, type: timer.type });
                                                }}
                                                style={{
                                                    border: 'none',
                                                    background: 'white',
                                                    width: '36px',
                                                    height: '36px',
                                                    borderRadius: '50%',
                                                    cursor: 'pointer',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    boxShadow: '0 2px 5px rgba(0,0,0,0.05)'
                                                }}
                                                title="Edit Timer"
                                            >
                                                ✏️
                                            </button>
                                            <button
                                                onClick={() => handleDeleteTimer(timer.id)}
                                                style={{
                                                    border: 'none',
                                                    background: 'white',
                                                    width: '36px',
                                                    height: '36px',
                                                    borderRadius: '50%',
                                                    cursor: 'pointer',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    boxShadow: '0 2px 5px rgba(0,0,0,0.05)'
                                                }}
                                                title="Delete Timer"
                                            >
                                                🗑️
                                            </button>
                                        </div>
                                    </div>
                                ))}
                                {timers.length === 0 && <p style={{ color: '#bbb', textAlign: 'center', fontStyle: 'italic' }}>No timers yet.</p>}
                            </div>
                        </div>
                    </>
                )}

                {/* Navigation Menu Removed */}
            </div>

            <style>
                {`
                    @keyframes bounce {
                        0%, 20%, 50%, 80%, 100% {transform: translateY(0);}
                        40% {transform: translateY(-6px);}
                        60% {transform: translateY(-3px);}
                    }
                    @keyframes fadeInUp {
                        from { opacity: 0; transform: translateY(20px); }
                        to { opacity: 1; transform: translateY(0); }
                    }
                `}
            </style>
        </div>
    );
};

export default PrivatePage;
