import React, { useState, useEffect } from 'react';
import { db } from '../../firebase';
import { collection, query, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, orderBy, Timestamp } from 'firebase/firestore';
import { useAuth } from '../../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { useNancyTheme } from '../../context/NancyThemeContext';

const CreativeMoments = () => {
    const { user } = useAuth();
    const navigate = useNavigate();
    const { currentBg } = useNancyTheme();
    const [moments, setMoments] = useState([]);
    const [formData, setFormData] = useState({ text: '', date: '' });
    const [editingId, setEditingId] = useState(null);

    // Fetch Moments
    useEffect(() => {
        if (!user) return;
        const q = query(
            collection(db, 'users', user.uid, 'nancy_creative_moments'),
            orderBy('createdAt', 'desc')
        );
        const unsubscribe = onSnapshot(q, (snapshot) => {
            setMoments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        }, (error) => console.error(error));
        return () => unsubscribe();
    }, [user]);

    const handleAdd = async (e) => {
        e.preventDefault();
        if (!formData.text.trim() || !user) return;


        // Actually, let's just prepare the payload
        const payload = {
            text: formData.text,
        };
        if (formData.date) {
            payload.createdAt = Timestamp.fromDate(new Date(formData.date));
        } else if (!editingId) {
            // Only add server timestamp for new docs if no manual date provided
            payload.createdAt = serverTimestamp();
        }

        try {
            if (editingId) {
                await updateDoc(doc(db, 'users', user.uid, 'nancy_creative_moments', editingId), payload);
                setEditingId(null);
            } else {
                await addDoc(collection(db, 'users', user.uid, 'nancy_creative_moments'), payload);
            }
            setFormData({ text: '', date: '' });
        } catch (error) {
            console.error(error);
            alert("Failed to save moment.");
        }
    };

    const handleEditClick = (moment) => {
        setEditingId(moment.id);

        let dateStr = '';
        if (moment.createdAt) {
            // Convert Firestore Timestamp to YYYY-MM-DDTHH:mm
            const dateObj = moment.createdAt.toDate ? moment.createdAt.toDate() : new Date(moment.createdAt);
            // safe check
            if (!isNaN(dateObj)) {
                // Adjust for timezone offset to show correct local time in input
                const tzOffset = dateObj.getTimezoneOffset() * 60000; // offset in milliseconds
                const localISOTime = (new Date(dateObj - tzOffset)).toISOString().slice(0, 16);
                dateStr = localISOTime;
            }
        }

        setFormData({
            text: moment.text,
            date: dateStr
        });

        // Scroll to form
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleDelete = async (id) => {
        if (!user || !window.confirm("Remove this moment?")) return;
        try {
            await deleteDoc(doc(db, 'users', user.uid, 'nancy_creative_moments', id));
        } catch (error) {
            console.error(error);
        }
    };

    return (
        <div style={{
            minHeight: '100vh',
            background: currentBg, // Dynamic tint
            padding: '4rem 1rem',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            position: 'relative'
        }}>
            {/* Back Button */}
            <button
                onClick={() => navigate('/nancy')}
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
                    lineHeight: 1
                }}
                onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.1)'}
                onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
                title="Back to Home"
            >
                ←
            </button>

            {/* Title */}
            <h1 style={{
                color: '#be185d',
                fontSize: '3rem',
                marginTop: '4rem',
                marginBottom: '1rem',
                textAlign: 'center',
                textShadow: '0 2px 5px rgba(190, 24, 93, 0.1)'
            }}>
                Somebody is creative...
            </h1>
            <p style={{ color: '#db2777', fontSize: '1.2rem', marginBottom: '3rem', fontStyle: 'italic' }}>
                It is of paramount importance that we capture the cutest moments of nancy.
            </p>

            {/* Add Input */}
            <div style={{ width: '100%', maxWidth: '600px', marginBottom: '3rem' }}>
                <form onSubmit={handleAdd} style={{ position: 'relative', background: 'white', padding: '1.5rem', borderRadius: '24px', boxShadow: '0 4px 20px rgba(236, 72, 153, 0.05)' }}>
                    <h3 style={{ marginTop: 0, color: '#be185d', fontSize: '1.2rem', marginBottom: '1rem' }}>
                        {editingId ? 'Edit Moment' : 'New Creative Moment'}
                    </h3>

                    <textarea
                        value={formData.text}
                        onChange={(e) => setFormData({ ...formData, text: e.target.value })}
                        placeholder="What creative/special thing did she do?"
                        style={{
                            width: '100%',
                            padding: '1rem',
                            borderRadius: '16px',
                            border: '1px solid #fbcfe8',
                            fontSize: '1rem',
                            outline: 'none',
                            resize: 'vertical',
                            minHeight: '100px',
                            fontFamily: 'inherit',
                            marginBottom: '1rem',
                            background: '#fffdfd'
                        }}
                    />

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                            <label style={{ fontSize: '0.8rem', color: '#be185d', fontWeight: 'bold' }}>Date (Optional)</label>
                            <input
                                type="datetime-local"
                                value={formData.date}
                                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                                style={{
                                    padding: '0.6rem',
                                    borderRadius: '10px',
                                    border: '1px solid #fbcfe8',
                                    color: '#555',
                                    outline: 'none'
                                }}
                            />
                        </div>

                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                            {editingId && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setEditingId(null);
                                        setFormData({ text: '', date: '' });
                                    }}
                                    style={{
                                        background: '#f3f4f6',
                                        color: '#374151',
                                        border: 'none',
                                        borderRadius: '50px',
                                        padding: '0.8rem 1.5rem',
                                        fontSize: '0.9rem',
                                        fontWeight: 'bold',
                                        cursor: 'pointer'
                                    }}
                                >
                                    Cancel
                                </button>
                            )}
                            <button type="submit" style={{
                                background: '#be185d',
                                color: 'white',
                                border: 'none',
                                borderRadius: '50px',
                                padding: '0.8rem 2rem',
                                fontSize: '1rem',
                                fontWeight: 'bold',
                                cursor: 'pointer',
                                boxShadow: '0 4px 10px rgba(190, 24, 93, 0.2)',
                                transition: 'transform 0.1s'
                            }}>
                                {editingId ? 'Update' : 'Add'}
                            </button>
                        </div>
                    </div>
                </form>
            </div>

            {/* List of Moments */}
            <div style={{
                width: '100%',
                maxWidth: '800px',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                gap: '1.5rem'
            }}>
                {moments.map(moment => (
                    <div key={moment.id} style={{
                        background: 'white',
                        padding: '1.25rem', // Reduced padding further
                        borderRadius: '24px',
                        boxShadow: '0 4px 15px rgba(236, 72, 153, 0.08)',
                        position: 'relative',
                        transition: 'transform 0.2s',
                        border: '1px solid rgba(255, 240, 245, 0.8)'
                    }}
                        onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-5px)'}
                        onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}
                    >
                        {/* Actions */}
                        <div style={{
                            position: 'absolute',
                            top: '1rem',
                            right: '1rem',
                            display: 'flex',
                            gap: '0.5rem',
                            zIndex: 10
                        }}>
                            <button
                                onClick={() => handleEditClick(moment)}
                                style={{
                                    border: 'none',
                                    background: 'none',
                                    cursor: 'pointer',
                                    opacity: 0.4,
                                    fontSize: '1.1rem'
                                }}
                                title="Edit"
                            >
                                ✏️
                            </button>
                            <button
                                onClick={() => handleDelete(moment.id)}
                                style={{
                                    border: 'none',
                                    background: 'none',
                                    cursor: 'pointer',
                                    opacity: 0.4,
                                    fontSize: '1.1rem'
                                }}
                                title="Delete"
                            >
                                ✖
                            </button>
                        </div>

                        <p style={{
                            fontSize: '1.15rem',
                            color: '#374151',
                            lineHeight: '1.6',
                            whiteSpace: 'pre-wrap',
                            marginBottom: '1rem',
                            marginTop: '0.5rem', // Reduced top margin
                            paddingRight: '3.5rem' // Prevent overlap with buttons
                        }}>
                            {moment.text}
                        </p>

                        {moment.createdAt && (
                            <div style={{
                                fontSize: '0.85rem',
                                color: '#be185d',
                                opacity: 0.6,
                                fontWeight: '600'
                            }}>
                                {new Date(moment.createdAt.toDate ? moment.createdAt.toDate() : moment.createdAt).toLocaleDateString(undefined, {
                                    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                                })}
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {moments.length === 0 && (
                <div style={{ textAlign: 'center', opacity: 0.6, marginTop: '2rem', color: '#9d174d' }}>
                    <p>No moments recorded yet.</p>
                </div>
            )}
        </div>
    );
};

export default CreativeMoments;
