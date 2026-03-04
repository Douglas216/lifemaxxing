import React, { useState, useEffect } from 'react';
import { db } from '../../firebase';
import { collection, query, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, orderBy } from 'firebase/firestore';
import { useAuth } from '../../context/AuthContext';
import NancyNavbar from '../../components/NancyNavbar';

import { useNancyTheme } from '../../context/NancyThemeContext';

const BucketList = () => {
    const { user } = useAuth();
    const { currentBg } = useNancyTheme();
    const [items, setItems] = useState([]);
    const [newItem, setNewItem] = useState('');
    const [editingId, setEditingId] = useState(null);
    const [editText, setEditText] = useState('');

    // Fetch Bucket List Items
    useEffect(() => {
        if (!user) return;

        const q = query(
            collection(db, 'users', user.uid, 'nancy_bucket_list'),
            orderBy('createdAt', 'desc')
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setItems(list);
        }, (error) => {
            console.error("Error fetching bucket list:", error);
        });

        return () => unsubscribe();
    }, [user]);

    const handleAdd = async (e) => {
        e.preventDefault();
        if (!newItem.trim() || !user) return;

        try {
            await addDoc(collection(db, 'users', user.uid, 'nancy_bucket_list'), {
                text: newItem,
                completed: false,
                createdAt: serverTimestamp(),
                createdBy: user.email
            });
            setNewItem('');
        } catch (error) {
            console.error("Error adding item:", error);
            alert("Failed to add item.");
        }
    };

    const handleToggle = async (id, currentStatus) => {
        if (!user) return;
        try {
            await updateDoc(doc(db, 'users', user.uid, 'nancy_bucket_list', id), {
                completed: !currentStatus
            });
        } catch (error) {
            console.error("Error updating item:", error);
        }
    };

    const handleDelete = async (id) => {
        if (!user) return;
        if (window.confirm('Delete this dream?')) {
            try {
                await deleteDoc(doc(db, 'users', user.uid, 'nancy_bucket_list', id));
            } catch (error) {
                console.error("Error deleting item:", error);
            }
        }
    };

    const startEdit = (item) => {
        setEditingId(item.id);
        setEditText(item.text);
    };

    const saveEdit = async () => {
        if (!editText.trim() || !user) return;
        try {
            await updateDoc(doc(db, 'users', user.uid, 'nancy_bucket_list', editingId), {
                text: editText
            });
            setEditingId(null);
        } catch (error) {
            console.error("Error saving edit:", error);
        }
    };

    const activeItems = items.filter(i => !i.completed);
    const completedItems = items.filter(i => i.completed);

    return (
        <div style={{
            minHeight: '100vh',
            background: currentBg, // Dynamic tint
            padding: '4rem 1rem',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center'
        }}>
            <NancyNavbar />

            <NancyNavbar />


            <div style={{ maxWidth: '800px', width: '100%', marginTop: '4rem' }}>
                <h1 style={{
                    color: '#be185d',
                    fontSize: '3rem',
                    textAlign: 'center',
                    marginBottom: '2rem',
                    textShadow: '0 2px 5px rgba(190, 24, 93, 0.1)'
                }}>
                    Our Bucket List
                </h1>

                {/* Add New Item */}
                <form onSubmit={handleAdd} style={{ marginBottom: '3rem', display: 'flex', gap: '1rem' }}>
                    <input
                        type="text"
                        value={newItem}
                        onChange={(e) => setNewItem(e.target.value)}
                        placeholder="What's our next adventure?"
                        style={{
                            flex: 1,
                            padding: '1rem 1.5rem',
                            borderRadius: '50px',
                            border: '2px solid rgba(236, 72, 153, 0.2)',
                            fontSize: '1.1rem',
                            outline: 'none',
                            boxShadow: '0 4px 10px rgba(236, 72, 153, 0.05)'
                        }}
                    />
                    <button type="submit" style={{
                        background: '#be185d',
                        color: 'white',
                        border: 'none',
                        borderRadius: '50px',
                        padding: '0 2rem',
                        fontSize: '1.1rem',
                        fontWeight: 'bold',
                        cursor: 'pointer',
                        boxShadow: '0 4px 15px rgba(190, 24, 93, 0.3)',
                        transition: 'transform 0.1s'
                    }}
                        onMouseDown={e => e.currentTarget.style.transform = 'scale(0.95)'}
                        onMouseUp={e => e.currentTarget.style.transform = 'scale(1)'}
                    >
                        Add
                    </button>
                </form>

                {/* Active Items */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '4rem' }}>
                    {activeItems.length === 0 ? (
                        <p style={{ textAlign: 'center', color: '#9d174d', opacity: 0.6 }}>No active dreams yet. Add one!</p>
                    ) : (
                        activeItems.map(item => (
                            <div key={item.id} style={{
                                background: 'white',
                                padding: '1.5rem',
                                borderRadius: '20px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
                                transition: 'all 0.2s'
                            }}>
                                {editingId === item.id ? (
                                    <div style={{ flex: 1, display: 'flex', gap: '0.5rem' }}>
                                        <input
                                            value={editText}
                                            onChange={e => setEditText(e.target.value)}
                                            style={{ flex: 1, padding: '0.5rem', borderRadius: '8px', border: '1px solid #ddd' }}
                                        />
                                        <button onClick={saveEdit} style={{ background: '#10b981', color: 'white', border: 'none', padding: '0.5rem 1rem', borderRadius: '8px', cursor: 'pointer' }}>Save</button>
                                        <button onClick={() => setEditingId(null)} style={{ background: '#6b7280', color: 'white', border: 'none', padding: '0.5rem 1rem', borderRadius: '8px', cursor: 'pointer' }}>Cancel</button>
                                    </div>
                                ) : (
                                    <>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flex: 1 }}>
                                            <div
                                                onClick={() => handleToggle(item.id, item.completed)}
                                                style={{
                                                    width: '24px',
                                                    height: '24px',
                                                    borderRadius: '6px',
                                                    border: '2px solid #be185d',
                                                    cursor: 'pointer',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center'
                                                }}
                                            />
                                            <span style={{ fontSize: '1.2rem', color: '#374151', fontWeight: '500' }}>{item.text}</span>
                                        </div>
                                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                                            <button onClick={() => startEdit(item)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem' }}>Edit</button>
                                            <button onClick={() => handleDelete(item.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem' }}>Delete</button>
                                        </div>
                                    </>
                                )}
                            </div>
                        ))
                    )}
                </div>

                {/* Completed Items */}
                {completedItems.length > 0 && (
                    <div>
                        <h2 style={{ color: '#be185d', fontSize: '1.8rem', marginBottom: '1.5rem', textAlign: 'center' }}>Accomplished ✅</h2>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', opacity: 0.8 }}>
                            {completedItems.map(item => (
                                <div key={item.id} style={{
                                    background: 'rgba(255, 255, 255, 0.6)',
                                    padding: '1rem 1.5rem',
                                    borderRadius: '20px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '1rem'
                                }}>
                                    <div
                                        onClick={() => handleToggle(item.id, item.completed)}
                                        style={{
                                            width: '24px',
                                            height: '24px',
                                            borderRadius: '6px',
                                            background: '#be185d',
                                            border: '2px solid #be185d',
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            color: 'white',
                                            fontWeight: 'bold'
                                        }}
                                    >✓</div>
                                    <span style={{
                                        fontSize: '1.1rem',
                                        color: '#be185d',
                                        textDecoration: 'line-through',
                                        flex: 1
                                    }}>
                                        {item.text}
                                    </span>
                                    <button onClick={() => handleDelete(item.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', opacity: 0.5 }}>✖</button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default BucketList;
