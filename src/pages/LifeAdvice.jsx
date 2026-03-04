import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    collection,
    addDoc,
    query,
    orderBy,
    onSnapshot,
    deleteDoc,
    doc,
    updateDoc,
    serverTimestamp
} from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { db } from '../firebase';
import './LifeAdvice.css';

const LifeAdvice = () => {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [advices, setAdvices] = useState([]);
    const [quote, setQuote] = useState('');
    const [author, setAuthor] = useState('');
    const [manualDate, setManualDate] = useState('');
    const [editId, setEditId] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!user) return;
        const q = query(collection(db, 'users', user.uid, 'life_advice'), orderBy('createdAt', 'desc'));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            setAdvices(snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            })));
            setLoading(false);
        });
        return () => unsubscribe();
    }, [user]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!quote.trim() || !author.trim()) return;

        try {
            if (editId) {
                await updateDoc(doc(db, 'users', user.uid, 'life_advice', editId), {
                    quote,
                    author,
                    manualDate,
                    updatedAt: serverTimestamp()
                });
                setEditId(null);
            } else {
                await addDoc(collection(db, 'users', user.uid, 'life_advice'), {
                    quote,
                    author,
                    manualDate,
                    createdAt: serverTimestamp()
                });
            }
            setQuote('');
            setAuthor('');
            setManualDate('');
        } catch (error) {
            console.error("Error saving advice:", error);
        }
    };

    const handleEdit = (advice) => {
        setQuote(advice.quote);
        setAuthor(advice.author);
        setManualDate(advice.manualDate || '');
        setEditId(advice.id);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleDelete = async (id) => {
        if (window.confirm('Delete this wisdom?')) {
            try {
                await deleteDoc(doc(db, 'users', user.uid, 'life_advice', id));
            } catch (error) {
                console.error("Error deleting advice:", error);
            }
        }
    };

    return (
        <div className="life-advice-page">
            <div onClick={() => navigate('/wishlist')} className="back-link">
                ← Back to Wishlist
            </div>

            <header className="life-advice-header">
                <h1>Elders' Wisdom</h1>
                <p>Timeless advice from those who have walked the path before us.</p>
            </header>

            <form className="life-advice-form-card" onSubmit={handleSubmit}>
                <div className="life-advice-input-group">
                    <label>The Advice</label>
                    <textarea
                        className="life-advice-input life-advice-textarea"
                        placeholder="What's the nugget of wisdom?"
                        value={quote}
                        onChange={(e) => setQuote(e.target.value)}
                        required
                    />
                </div>
                <div className="life-advice-input-group">
                    <label>Who said it?</label>
                    <input
                        type="text"
                        className="life-advice-input"
                        placeholder="Name of professor, elder, or mentor"
                        value={author}
                        onChange={(e) => setAuthor(e.target.value)}
                        required
                    />
                </div>
                <div className="life-advice-input-group">
                    <label>Date Received</label>
                    <input
                        type="date"
                        className="life-advice-input"
                        value={manualDate}
                        onChange={(e) => setManualDate(e.target.value)}
                    />
                </div>
                <button type="submit" className="life-advice-submit-btn">
                    {editId ? 'Update Wisdom' : 'Record Wisdom'}
                </button>
                {editId && (
                    <button
                        type="button"
                        onClick={() => { setEditId(null); setQuote(''); setAuthor(''); setManualDate(''); }}
                        style={{ background: 'transparent', color: '#666', marginTop: '-1rem', cursor: 'pointer', border: 'none' }}
                    >
                        Cancel Edit
                    </button>
                )}
            </form>

            <div className="life-advice-list">
                {advices.map(advice => (
                    <div key={advice.id} className="life-advice-card">
                        <div className="life-advice-actions">
                            <button className="life-advice-action-btn" onClick={() => handleEdit(advice)} title="Edit">✏️</button>
                            <button className="life-advice-action-btn delete" onClick={() => handleDelete(advice.id)} title="Delete">🗑️</button>
                        </div>
                        <div className="life-advice-quote">"{advice.quote}"</div>
                        <div className="life-advice-author">— {advice.author}</div>
                        {advice.manualDate && (
                            <div className="life-advice-date" style={{ marginTop: '0.5rem', textAlign: 'right', fontStyle: 'italic' }}>
                                {new Date(advice.manualDate + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                            </div>
                        )}
                    </div>
                ))}
                {!loading && advices.length === 0 && (
                    <p style={{ textAlign: 'center', gridColumn: '1/-1', color: '#999' }}>
                        No advice recorded yet.
                    </p>
                )}
            </div>
        </div>
    );
};

export default LifeAdvice;
