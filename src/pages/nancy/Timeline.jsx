import React, { useState, useEffect } from 'react';
import { db } from '../../firebase';
import { collection, query, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, orderBy } from 'firebase/firestore';
import { useAuth } from '../../context/AuthContext';
import NancyNavbar from '../../components/NancyNavbar';
import { useNancyTheme } from '../../context/NancyThemeContext';

const Timeline = () => {
    const { user } = useAuth();
    const { currentBg } = useNancyTheme();
    const [events, setEvents] = useState([]);
    const [isAdding, setIsAdding] = useState(false);
    const [newEvent, setNewEvent] = useState({ date: '', title: '', description: '', icon: '❤️', imageUrl: '' });
    const [editingId, setEditingId] = useState(null);

    // Fetch Timeline Events
    useEffect(() => {
        if (!user) return;
        const q = query(
            collection(db, 'users', user.uid, 'nancy_timeline'),
            orderBy('date', 'asc') // Oldest first (Newer to the right)
        );
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const fetchedEvents = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            // Client-side sort to guarantee order (Oldest -> Newest)
            fetchedEvents.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
            setEvents(fetchedEvents);
        }, (error) => console.error(error));
        return () => unsubscribe();
    }, [user]);

    const handleAdd = async (e) => {
        e.preventDefault();
        if (!newEvent.date || !newEvent.title || !user) return;

        try {
            if (editingId) {
                await updateDoc(doc(db, 'users', user.uid, 'nancy_timeline', editingId), {
                    ...newEvent,
                    updatedAt: serverTimestamp()
                });
            } else {
                await addDoc(collection(db, 'users', user.uid, 'nancy_timeline'), {
                    ...newEvent,
                    createdAt: serverTimestamp()
                });
            }

            setNewEvent({ date: '', title: '', description: '', icon: '❤️', imageUrl: '' });
            setEditingId(null);
            setIsAdding(false);
        } catch (error) {
            console.error("Detailed Error:", error);
            alert(`Failed to save memory: ${error.message}`);
        }
    };

    const handleDelete = async (id) => {
        if (!user || !window.confirm("Remove this memory?")) return;
        try {
            await deleteDoc(doc(db, 'users', user.uid, 'nancy_timeline', id));
        } catch (error) {
            console.error(error);
        }
    };

    return (
        <div style={{
            minHeight: '100vh',
            background: currentBg, // Dynamic tint
            padding: '2rem 1rem',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            position: 'relative',
            overflowX: 'hidden'
        }}>
            <NancyNavbar />

            <h1 style={{ color: '#be185d', fontSize: '3rem', marginTop: '4rem', marginBottom: '2rem', textShadow: '0 2px 5px rgba(190, 24, 93, 0.1)' }}>Our Timeline</h1>

            {/* Add Button */}
            <button
                onClick={() => {
                    setIsAdding(!isAdding);
                    if (isAdding) {
                        setEditingId(null);
                        setNewEvent({ date: '', title: '', description: '', icon: '❤️', imageUrl: '' });
                    }
                }}
                style={{
                    background: '#be185d',
                    color: 'white',
                    border: 'none',
                    padding: '0.8rem 2rem',
                    borderRadius: '50px',
                    fontSize: '1.1rem',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    boxShadow: '0 4px 15px rgba(190, 24, 93, 0.2)',
                    marginBottom: '3rem',
                    zIndex: 10
                }}
            >
                {isAdding ? 'Cancel' : '+ Add Memory'}
            </button>

            {/* Add Form */}
            {isAdding && (
                <form onSubmit={handleAdd} style={{
                    background: 'white',
                    padding: '2rem',
                    borderRadius: '24px',
                    boxShadow: '0 10px 30px rgba(0,0,0,0.1)',
                    width: '100%',
                    maxWidth: '500px',
                    marginBottom: '3rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '1rem',
                    animation: 'fadeInUp 0.3s ease-out',
                    zIndex: 10
                }}>
                    <div style={{ display: 'flex', gap: '1rem' }}>
                        <input
                            type="date"
                            required
                            value={newEvent.date}
                            onChange={e => setNewEvent({ ...newEvent, date: e.target.value })}
                            style={{ padding: '0.8rem', borderRadius: '12px', border: '1px solid #ddd', flex: 1 }}
                        />
                        <select
                            value={newEvent.icon}
                            onChange={e => setNewEvent({ ...newEvent, icon: e.target.value })}
                            style={{ padding: '0.8rem', borderRadius: '12px', border: '1px solid #ddd', fontSize: '1.2rem' }}
                        >
                            <option value="❤️">❤️ Love</option>
                            <option value="✈️">✈️ Trip</option>
                            <option value="📅">📅 Date</option>
                            <option value="🏠">🏠 Home</option>
                            <option value="🎉">🎉 Party</option>
                            <option value="✨">✨ Special</option>
                        </select>
                    </div>
                    <input
                        type="text"
                        placeholder="Title (e.g., First Date)"
                        required
                        value={newEvent.title}
                        onChange={e => setNewEvent({ ...newEvent, title: e.target.value })}
                        style={{ padding: '0.8rem', borderRadius: '12px', border: '1px solid #ddd', fontSize: '1.1rem' }}
                    />
                    <input
                        type="url"
                        placeholder="Image URL (optional)"
                        value={newEvent.imageUrl || ''}
                        onChange={e => setNewEvent({ ...newEvent, imageUrl: e.target.value })}
                        style={{ padding: '0.8rem', borderRadius: '12px', border: '1px solid #ddd', fontSize: '1.1rem' }}
                    />
                    <textarea
                        placeholder="Description (optional)"
                        value={newEvent.description}
                        onChange={e => setNewEvent({ ...newEvent, description: e.target.value })}
                        style={{ padding: '0.8rem', borderRadius: '12px', border: '1px solid #ddd', minHeight: '80px', fontFamily: 'inherit' }}
                    />
                    <button type="submit" style={{
                        background: '#be185d',
                        color: 'white',
                        border: 'none',
                        padding: '1rem',
                        borderRadius: '12px',
                        fontWeight: 'bold',
                        cursor: 'pointer',
                        fontSize: '1rem',
                    }}>
                        {editingId ? 'Update Memory' : 'Save Memory'}
                    </button>
                </form>
            )}

            {/* Horizontal Timeline Container */}
            <div style={{
                position: 'relative',
                width: '100%',
                overflowX: 'auto',
                padding: '2rem 1rem',
                display: 'flex',
                alignItems: 'center',
                minHeight: '700px',
                scrollBehavior: 'smooth'
            }}>
                {/* Scroll Wrapper */}
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '0 2rem', // Side padding
                    minHeight: '600px',
                    position: 'relative'
                }}>
                    {events.map((event, index) => {
                        const isTop = index % 2 === 0;

                        return (
                            <div key={event.id} style={{
                                flex: '0 0 auto',
                                width: '300px',
                                marginRight: '2rem',
                                position: 'relative',
                                height: '700px', // Tall container to fit card
                            }}>
                                {/* Central Horizontal Line Segment running through this slot */}
                                <div style={{
                                    position: 'absolute',
                                    top: '50%',
                                    left: 0,
                                    right: '-2rem', // Connect to next
                                    height: '4px',
                                    background: 'rgba(190, 24, 93, 0.2)',
                                    marginTop: '-2px',
                                    zIndex: 0
                                }} />

                                {/* Center Dot on the Timeline */}
                                <div style={{
                                    position: 'absolute',
                                    top: '50%',
                                    left: '50%',
                                    transform: 'translate(-50%, -50%)',
                                    width: '16px',
                                    height: '16px',
                                    background: '#be185d',
                                    borderRadius: '50%',
                                    border: '3px solid white',
                                    boxShadow: '0 0 0 4px rgba(190, 24, 93, 0.1)',
                                    zIndex: 2
                                }} />

                                {/* Vertical Connector Stick */}
                                <div style={{
                                    position: 'absolute',
                                    left: '50%',
                                    width: '2px',
                                    background: '#be185d',
                                    opacity: 0.3,
                                    // Connect from center (50%) to Card Start
                                    top: isTop ? 'auto' : '50%',
                                    bottom: isTop ? '50%' : 'auto',
                                    height: '3rem', // Fixed distance to card
                                    transform: 'translateX(-50%)',
                                    zIndex: 0
                                }} />

                                {/* Card - Absolutely Positioned */}
                                <div style={{
                                    position: 'absolute',
                                    left: '0',
                                    width: '100%',
                                    // Position relative to center
                                    top: isTop ? 'auto' : '50%',
                                    bottom: isTop ? '50%' : 'auto',
                                    // Push away by stick height
                                    marginTop: isTop ? 0 : '3rem',
                                    marginBottom: isTop ? '3rem' : 0,

                                    background: 'white',
                                    padding: '1.5rem',
                                    borderRadius: '16px',
                                    boxShadow: '0 10px 25px rgba(190, 24, 93, 0.1)',
                                    border: '1px solid rgba(190, 24, 93, 0.1)',
                                    cursor: 'default',
                                    zIndex: 1,
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'center',
                                    textAlign: 'center'
                                }}
                                >
                                    <div style={{
                                        position: 'absolute',
                                        top: '0.5rem',
                                        right: '0.5rem',
                                        display: 'flex',
                                        gap: '0.5rem'
                                    }}>
                                        <div style={{
                                            cursor: 'pointer',
                                            opacity: 0.5,
                                            padding: '5px'
                                        }} onClick={(e) => {
                                            e.stopPropagation();
                                            setEditingId(event.id);
                                            setNewEvent(event);
                                            setIsAdding(true);
                                            window.scrollTo({ top: 0, behavior: 'smooth' });
                                        }}>
                                            ✏️
                                        </div>
                                        <div style={{
                                            cursor: 'pointer',
                                            opacity: 0.5,
                                            padding: '5px'
                                        }} onClick={(e) => { e.stopPropagation(); handleDelete(event.id); }}>
                                            ✖
                                        </div>
                                    </div>

                                    <div style={{ fontSize: '2.5rem', lineHeight: 1, marginBottom: '0.5rem' }}>{event.icon}</div>
                                    <div style={{
                                        textTransform: 'uppercase',
                                        fontSize: '0.75rem',
                                        fontWeight: '800',
                                        color: '#be185d',
                                        letterSpacing: '1px',
                                        marginBottom: '0.5rem'
                                    }}>
                                        {new Date(event.date + 'T12:00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                                    </div>
                                    {event.imageUrl && (
                                        <img
                                            src={event.imageUrl}
                                            alt={event.title}
                                            style={{
                                                width: '100%',
                                                height: '140px',
                                                objectFit: 'cover',
                                                borderRadius: '12px',
                                                marginBottom: '0.5rem',
                                                marginTop: '0.25rem'
                                            }}
                                        />
                                    )}
                                    <h3 style={{ margin: '0 0 0.5rem 0', color: '#1f2937', fontSize: '1.1rem', fontWeight: '700' }}>{event.title}</h3>
                                    {event.description && (
                                        <p style={{
                                            margin: 0,
                                            color: '#6b7280',
                                            fontSize: '0.9rem',
                                            lineHeight: 1.5,
                                            maxHeight: '200px',
                                            overflowY: 'auto',
                                            paddingRight: '0.5rem',
                                            whiteSpace: 'pre-wrap' // Preserves line breaks
                                        }}>{event.description}</p>
                                    )}
                                </div>
                            </div>
                        );
                    })}

                    {events.length === 0 && (
                        <div style={{ textAlign: 'center', background: 'white', padding: '2rem', borderRadius: '20px', width: '300px' }}>
                            <p style={{ color: '#9d174d' }}>No memories yet. Add one above! 👆</p>
                        </div>
                    )}
                </div>
            </div>

            <style>{`
                @keyframes fadeInUp {
                    from { opacity: 0; transform: translateY(10px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                /* Hide scrollbar for cleaner look */
                div::-webkit-scrollbar {
                    height: 8px;
                }
                div::-webkit-scrollbar-track {
                    background: transparent; 
                }
                div::-webkit-scrollbar-thumb {
                    background: rgba(190, 24, 93, 0.2); 
                    border-radius: 4px;
                }
                div::-webkit-scrollbar-thumb:hover {
                    background: rgba(190, 24, 93, 0.4); 
                }
            `}</style>
        </div>
    );
};

export default Timeline;
