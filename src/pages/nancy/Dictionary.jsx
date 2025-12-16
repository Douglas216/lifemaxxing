import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../../firebase';
import { collection, query, onSnapshot, addDoc, deleteDoc, doc, serverTimestamp, orderBy } from 'firebase/firestore';
import { useAuth } from '../../context/AuthContext';

const NancyDictionary = () => {
    const navigate = useNavigate();
    const { user } = useAuth();
    const [entries, setEntries] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');

    // Fetch Dictionary Entries
    useEffect(() => {
        if (!user) return;
        const q = query(
            collection(db, 'users', user.uid, 'nancy_dictionary'),
            orderBy('word', 'asc') // Alphabetical order
        );
        const unsubscribe = onSnapshot(q, (snapshot) => {
            setEntries(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        }, (error) => console.error(error));
        return () => unsubscribe();
    }, [user]);

    const handleDelete = async (id) => {
        if (!window.confirm("Delete this definition?")) return;
        await deleteDoc(doc(db, 'users', user.uid, 'nancy_dictionary', id));
    };

    const filteredEntries = entries.filter(entry =>
        entry.word.toLowerCase().includes(searchTerm.toLowerCase()) ||
        entry.definition.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const leftEntries = filteredEntries.filter((_, i) => i % 2 === 0);
    const rightEntries = filteredEntries.filter((_, i) => i % 2 !== 0);

    const BookEntry = ({ entry }) => (
        <div style={{ marginBottom: '1.5rem', position: 'relative' }}>
            <button
                onClick={() => handleDelete(entry.id)}
                style={{
                    position: 'absolute',
                    right: 0,
                    top: 0,
                    background: 'none',
                    border: 'none',
                    color: '#9ca3af',
                    cursor: 'pointer',
                    fontSize: '1rem',
                    opacity: 0.3
                }}
                title="Delete Entry"
            >
                ✖
            </button>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap' }}>
                <strong style={{ fontSize: '1.2rem', fontFamily: '"Times New Roman", serif', color: '#111' }}>
                    {entry.word}
                </strong>
            </div>
            <p style={{ margin: '0.2rem 0 0.5rem 0', fontSize: '1rem', lineHeight: '1.5', color: '#333' }}>
                {entry.definition}
            </p>
        </div>
    );

    return (
        <div style={{
            minHeight: '100vh',
            background: '#e5e7eb', // Desk surface color
            padding: '2rem 1rem',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            fontFamily: '"Merriweather", "Times New Roman", serif',
            overflowX: 'hidden'
        }}>
            {/* Back Button */}
            <button
                onClick={() => navigate('/private')}
                style={{
                    position: 'absolute',
                    top: '2rem',
                    left: '2rem',
                    background: 'white',
                    border: 'none',
                    borderRadius: '50%',
                    width: '50px',
                    height: '50px',
                    boxShadow: '0 4px 10px rgba(0,0,0,0.1)',
                    cursor: 'pointer',
                    fontSize: '1.5rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 20
                }}
                title="Back to Home"
            >
                ←
            </button>

            {/* Controls (Floating above book) */}
            <div style={{ marginBottom: '2rem', width: '100%', maxWidth: '1000px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                <h1 style={{ margin: 0, fontSize: '2rem', color: '#1f2937' }}>The Nancy Dictionary 📖</h1>
                <div style={{ display: 'flex', gap: '1rem' }}>
                    <input
                        type="text"
                        placeholder="Search..."
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        style={{ padding: '0.8rem', borderRadius: '4px', border: '1px solid #ccc', minWidth: '200px' }}
                    />
                    <button onClick={async () => {
                        const word = prompt("Word:");
                        if (!word) return;
                        const def = prompt("Definition:");
                        if (!def) return;

                        if (word && def && user) {
                            await addDoc(collection(db, 'users', user.uid, 'nancy_dictionary'), {
                                word: word.trim(),
                                definition: def.trim(),
                                createdAt: serverTimestamp()
                            });
                        }
                    }} style={{ background: '#be185d', color: 'white', border: 'none', padding: '0.8rem 1.5rem', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>+ Add Word</button>
                </div>
            </div>

            {/* The Open Book */}
            <div style={{
                width: '100%',
                maxWidth: '1200px',
                aspectRatio: '1.4 / 1', // Approximate open book ratio
                minHeight: '80vh',      // Ensure height on mobile
                background: '#fffbf0',  // Paper color
                display: 'flex',
                boxShadow: '0 20px 50px rgba(0,0,0,0.3), inset 0 0 100px rgba(0,0,0,0.05)', // Deep shadow + inset vignette
                borderRadius: '4px 8px 8px 4px',
                position: 'relative'
            }}>
                {/* Left Page */}
                <div style={{
                    flex: 1,
                    padding: '3rem 4rem 3rem 3rem',
                    borderRight: '1px solid rgba(0,0,0,0.1)',
                    position: 'relative',
                    overflowY: 'auto'
                }}>
                    {/* Header */}
                    <div style={{ position: 'absolute', top: '1rem', left: '3rem', fontSize: '0.9rem', color: '#999', fontWeight: 'bold' }}>
                        {leftEntries[0]?.word?.charAt(0) || 'A'}
                    </div>

                    <div style={{ columnCount: 1 }}> {/* Per user request: 1 column per page */}
                        {leftEntries.map(entry => <BookEntry key={entry.id} entry={entry} />)}
                        {leftEntries.length === 0 && <p style={{ color: '#ccc', textAlign: 'center', marginTop: '4rem' }}>(Left Page Empty)</p>}
                    </div>
                </div>

                {/* Spine / Center Fold */}
                <div style={{
                    width: '60px',
                    background: 'linear-gradient(to right, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0) 40%, rgba(0,0,0,0) 60%, rgba(0,0,0,0.15) 100%)',
                    height: '100%',
                    position: 'absolute',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    zIndex: 10,
                    pointerEvents: 'none' // Click through spine
                }} />

                {/* Right Page */}
                <div style={{
                    flex: 1,
                    padding: '3rem 3rem 3rem 4rem',
                    position: 'relative',
                    overflowY: 'auto'
                }}>
                    {/* Header */}
                    <div style={{ position: 'absolute', top: '1rem', right: '3rem', fontSize: '0.9rem', color: '#999', fontWeight: 'bold' }}>
                        {rightEntries[rightEntries.length - 1]?.word?.charAt(0) || 'Z'}
                    </div>

                    <div style={{ columnCount: 1 }}>
                        {rightEntries.map(entry => <BookEntry key={entry.id} entry={entry} />)}
                        {rightEntries.length === 0 && <p style={{ color: '#ccc', textAlign: 'center', marginTop: '4rem' }}>(Right Page Empty)</p>}
                    </div>
                </div>
            </div>

            {/* Thick Cover Edges (Visual Flair) */}
            <div style={{ width: '98%', maxWidth: '1220px', height: '10px', background: '#374151', borderRadius: '0 0 10px 10px', marginTop: '-4px', zIndex: -1 }}></div>
        </div>
    );
};

export default NancyDictionary;
