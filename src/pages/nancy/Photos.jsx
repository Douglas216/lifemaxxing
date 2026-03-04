import React, { useState, useEffect } from 'react';
import { db } from '../../firebase';
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '../../context/AuthContext';
import NancyNavbar from '../../components/NancyNavbar';

import { useNancyTheme } from '../../context/NancyThemeContext';

const Photos = () => {
    const { user } = useAuth();
    const { currentBg } = useNancyTheme();
    const [albumUrl, setAlbumUrl] = useState('');
    const [isEditing, setIsEditing] = useState(false);
    const [inputUrl, setInputUrl] = useState('');

    // Fetch Album Settings
    useEffect(() => {
        if (!user) return;
        const unsub = onSnapshot(doc(db, 'users', user.uid, 'nancy_settings', 'photos'), (docSnap) => {
            if (docSnap.exists()) {
                setAlbumUrl(docSnap.data().albumUrl || '');
            }
        });
        return () => unsub();
    }, [user]);

    const handleSaveLink = async (e) => {
        e.preventDefault();
        if (!user) return;
        try {
            // Normalize URL slightly?
            await setDoc(doc(db, 'users', user.uid, 'nancy_settings', 'photos'), {
                albumUrl: inputUrl,
                updatedAt: serverTimestamp()
            }, { merge: true });
            setIsEditing(false);
        } catch (error) {
            console.error(error);
            alert("Failed to save link.");
        }
    };

    return (
        <div style={{
            minHeight: '100vh',
            background: currentBg,
            padding: '4rem 1rem',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center' // Center vertically as it's now a portal page
        }}>
            <NancyNavbar />

            <div style={{
                textAlign: 'center',
                maxWidth: '600px',
                width: '100%',
                background: 'rgba(255, 255, 255, 0.6)',
                backdropFilter: 'blur(10px)',
                padding: '3rem 2rem',
                borderRadius: '30px',
                boxShadow: '0 20px 50px rgba(0,0,0,0.1)',
                border: '1px solid rgba(255,255,255,0.5)'
            }}>
                <h1 style={{
                    color: '#be185d',
                    fontSize: '2.5rem',
                    marginBottom: '1rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '1rem'
                }}>
                    Photo Album
                </h1>

                <p style={{ color: '#666', marginBottom: '2rem', fontSize: '1.1rem', lineHeight: '1.6' }}>
                    Can we please make moooooore memories together?
                </p>

                {!albumUrl || isEditing ? (
                    <form onSubmit={handleSaveLink} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        <input
                            type="url"
                            placeholder="Paste iCloud Shared Album URL here..."
                            value={inputUrl}
                            onChange={e => setInputUrl(e.target.value)}
                            required
                            style={{
                                padding: '1rem',
                                borderRadius: '15px',
                                border: '1px solid #ddd',
                                fontSize: '1rem',
                                width: '100%',
                                boxSizing: 'border-box'
                            }}
                        />
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <button type="submit" style={{
                                flex: 1,
                                background: '#3b82f6', // iCloud Blue-ish
                                color: 'white',
                                border: 'none',
                                padding: '1rem',
                                borderRadius: '15px',
                                fontWeight: 'bold',
                                cursor: 'pointer',
                                fontSize: '1rem'
                            }}>
                                Save Link
                            </button>
                            {albumUrl && <button type="button" onClick={() => setIsEditing(false)} style={{ padding: '0 1rem', borderRadius: '15px', border: 'none', background: '#ddd', cursor: 'pointer' }}>Cancel</button>}
                        </div>
                    </form>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem' }}>
                        <a
                            href={albumUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '1rem',
                                background: 'linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%)',
                                color: 'white',
                                textDecoration: 'none',
                                padding: '1.2rem 3rem',
                                borderRadius: '50px',
                                fontSize: '1.2rem',
                                fontWeight: 'bold',
                                boxShadow: '0 10px 25px rgba(59, 130, 246, 0.3)',
                                transition: 'transform 0.2s',
                                width: '100%',
                                justifyContent: 'center',
                                boxSizing: 'border-box'
                            }}
                            onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.02)'}
                            onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
                        >
                            Open iCloud Album ↗
                        </a>

                        <button
                            onClick={() => {
                                setInputUrl(albumUrl);
                                setIsEditing(true);
                            }}
                            style={{
                                background: 'none',
                                border: 'none',
                                color: '#9ca3af',
                                fontSize: '0.9rem',
                                cursor: 'pointer',
                                textDecoration: 'underline'
                            }}
                        >
                            Change Link
                        </button>
                    </div>
                )}
            </div>

            <style>{`
                @keyframes float {
                    0% { transform: translateY(0px); }
                    50% { transform: translateY(-10px); }
                    100% { transform: translateY(0px); }
                }
            `}</style>
        </div>
    );
};

export default Photos;
