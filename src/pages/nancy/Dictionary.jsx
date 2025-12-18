import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../../firebase';
import { collection, query, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, orderBy } from 'firebase/firestore';
import { useAuth } from '../../context/AuthContext';
import { pinyin } from 'pinyin-pro';
import { useNancyTheme } from '../../context/NancyThemeContext';

const NancyDictionary = () => {
    const navigate = useNavigate();
    const { user } = useAuth();
    const { currentBg } = useNancyTheme();
    const [entries, setEntries] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [isBookOpen, setIsBookOpen] = useState(false); // Book state
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [newWord, setNewWord] = useState('');
    const [meanings, setMeanings] = useState([{ id: Date.now(), partOfSpeech: 'noun', definition: '', example: '' }]);
    const [editingId, setEditingId] = useState(null);
    const [pageIndex, setPageIndex] = useState(0);

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

    const handleEdit = (entry) => {
        setEditingId(entry.id);
        setNewWord(entry.word);
        if (entry.meanings && Array.isArray(entry.meanings)) {
            setMeanings(entry.meanings.map(m => ({ ...m, id: m.id || Date.now() + Math.random() })));
        } else {
            // Backwards compatibility
            setMeanings([{
                id: Date.now(),
                partOfSpeech: entry.partOfSpeech || 'noun',
                definition: entry.definition || '',
                example: entry.example || ''
            }]);
        }
        setIsModalOpen(true);
    };

    const handleDelete = async (id) => {
        if (!window.confirm("Delete this definition?")) return;
        await deleteDoc(doc(db, 'users', user.uid, 'nancy_dictionary', id));
    };

    const filteredEntries = entries.filter(entry =>
        entry.word.toLowerCase().includes(searchTerm.toLowerCase()) ||
        entry.definition.toLowerCase().includes(searchTerm.toLowerCase())
    );

    // Helper to identify emoji-starts or symbol-starts (non-alphanumeric/non-Chinese)
    const isEmojiWord = (word) => {
        if (!word) return false;
        // Matches standard Latin, numbers, accented chars, and Chinese
        return !/^[a-zA-Z0-9\u00C0-\u024F\u4e00-\u9fa5]/.test(word);
    };

    // Sort: Emojis last, Chinese by Pinyin, English normally
    const sortedEntries = [...filteredEntries].sort((a, b) => {
        const isEmojiA = isEmojiWord(a.word);
        const isEmojiB = isEmojiWord(b.word);

        if (isEmojiA && !isEmojiB) return 1;
        if (!isEmojiA && isEmojiB) return -1;

        const getKey = (w) => {
            if (!w) return '';
            return /[\u4e00-\u9fa5]/.test(w)
                ? pinyin(w, { toneType: 'none' }).toLowerCase()
                : w.toLowerCase();
        };
        return getKey(a.word).localeCompare(getKey(b.word));
    });

    // Helper to get guide letter (First/Last word on page, ignoring emojis, handling Pinyin)
    const getGuideLetter = (entries, position) => {
        const textEntries = entries.filter(e => !isEmojiWord(e.word));
        if (textEntries.length === 0) return ''; // No text words on this page

        const entry = position === 'start' ? textEntries[0] : textEntries[textEntries.length - 1];
        const word = entry.word;

        if (/[\u4e00-\u9fa5]/.test(word)) {
            return pinyin(word, { toneType: 'none' }).charAt(0).toUpperCase();
        }
        return word.charAt(0).toUpperCase();
    };

    // Pagination Logic (Height Estimation)
    const pages = React.useMemo(() => {
        const MAX_HEIGHT = 650; // Approx usable pixels per page
        const pagesArray = [];
        let currentPage = [];
        let currentHeight = 0;

        sortedEntries.forEach(entry => {
            // Heuristic Height Calculation
            // Heuristic Height Calculation
            const baseHeight = 60; // Title line + spacing
            let contentHeight = 0;

            const entryMeanings = entry.meanings || [{ definition: entry.definition, example: entry.example }];

            entryMeanings.forEach(m => {
                const defH = Math.ceil((m.definition || '').length / 50) * 30;
                const exH = m.example ? Math.ceil(m.example.length / 50) * 25 : 0;
                contentHeight += defH + exH + 30; // + spacing for each meaning
            });

            const totalEntryHeight = baseHeight + contentHeight + 20; // + margin

            if (currentHeight + totalEntryHeight > MAX_HEIGHT) {
                pagesArray.push(currentPage);
                currentPage = [];
                currentHeight = 0;
            }

            currentPage.push(entry);
            currentHeight += totalEntryHeight;
        });

        if (currentPage.length > 0) {
            pagesArray.push(currentPage);
        }

        return pagesArray;
    }, [sortedEntries]);

    // Ensure we have at least 2 empty pages if no content
    const safePages = pages.length > 0 ? pages : [[], []];

    // Current View (Left + Right Page)
    // If pageIndex is 0, we show Page 0 (Left) and Page 1 (Right)
    const leftEntries = safePages[pageIndex * 2] || [];
    const rightEntries = safePages[pageIndex * 2 + 1] || [];

    const totalViews = Math.ceil(safePages.length / 2);

    const nextPage = () => {
        if (pageIndex < totalViews - 1) setPageIndex(pageIndex + 1);
    };

    const prevPage = () => {
        if (pageIndex > 0) setPageIndex(pageIndex - 1);
    };

    const BookEntry = ({ entry }) => {
        // Simple check for Chinese characters
        const isChinese = /[\u4e00-\u9fa5]/.test(entry.word);
        const pinyinText = isChinese ? pinyin(entry.word) : null;

        const normalizedMeanings = entry.meanings || [{
            partOfSpeech: entry.partOfSpeech,
            definition: entry.definition,
            example: entry.example
        }];

        return (
            <div style={{ marginBottom: '2.5rem', position: 'relative' }}>
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
                        fontSize: '1.2rem',
                        opacity: 0.3
                    }}
                    title="Delete Entry"
                >
                    ✖
                </button>
                <button
                    onClick={() => handleEdit(entry)}
                    style={{
                        position: 'absolute',
                        right: '30px',
                        top: 0,
                        background: 'none',
                        border: 'none',
                        color: '#9ca3af',
                        cursor: 'pointer',
                        fontSize: '1.2rem',
                        opacity: 0.3
                    }}
                    title="Edit Entry"
                >
                    ✎
                </button>

                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.8rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                    <strong style={{ fontSize: '1.6rem', fontFamily: '"Times New Roman", serif', color: '#111' }}>
                        {entry.word}
                    </strong>
                    {pinyinText && (
                        <span style={{ fontSize: '1.2rem', color: '#888', fontFamily: '"Arial", sans-serif' }}>
                            [{pinyinText}]
                        </span>
                    )}
                </div>

                {normalizedMeanings.map((meaning, index) => (
                    <div key={index} style={{ marginBottom: '1rem' }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                            {meaning.partOfSpeech && (
                                <span style={{ fontSize: '1.1rem', fontStyle: 'italic', color: '#be185d', fontWeight: 600 }}>
                                    {meaning.partOfSpeech}
                                </span>
                            )}
                        </div>
                        <p style={{ margin: '0.2rem 0 0.2rem 0', fontSize: '1.3rem', lineHeight: '1.5', color: '#333' }}>
                            {meaning.definition}
                        </p>
                        {meaning.example && (
                            <p style={{ margin: '0.3rem 0 0', fontSize: '1.1rem', color: '#555', fontStyle: 'italic', borderLeft: '3px solid #ddd', paddingLeft: '10px' }}>
                                "{meaning.example}"
                            </p>
                        )}
                    </div>
                ))}
            </div>
        );
    };

    const BookCover = () => (
        <div
            onClick={() => setIsBookOpen(true)}
            style={{
                width: 'min(90vw, 500px)',
                aspectRatio: '0.75 / 1', // Portrait book ratio
                background: '#14532d', // Deep Green ("Leather")
                borderRadius: '8px 16px 16px 8px',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5), inset -20px 0 40px rgba(0,0,0,0.3), inset 2px 1px 4px rgba(255,255,255,0.1)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: 'center',
                padding: '3rem',
                cursor: 'pointer',
                position: 'relative',
                transformStyle: 'preserve-3d',
                transition: 'transform 0.4s ease, box-shadow 0.4s ease',
                borderLeft: '12px solid #064e3b', // Spine darkening
                textAlign: 'center'
            }}
            onMouseEnter={e => {
                e.currentTarget.style.transform = 'translateY(-10px) rotateY(-5deg)';
                e.currentTarget.style.boxShadow = '0 35px 60px -15px rgba(0, 0, 0, 0.6), inset -20px 0 40px rgba(0,0,0,0.3)';
            }}
            onMouseLeave={e => {
                e.currentTarget.style.transform = 'translateY(0) rotateY(0)';
                e.currentTarget.style.boxShadow = '0 25px 50px -12px rgba(0, 0, 0, 0.5), inset -20px 0 40px rgba(0,0,0,0.3)';
            }}
        >
            {/* Gold Border / Engraving */}
            <div style={{
                position: 'absolute',
                top: '20px', bottom: '20px', left: '20px', right: '20px',
                border: '2px solid #fbbf24', // Gold
                borderRadius: '4px 12px 12px 4px',
                opacity: 0.5,
                pointerEvents: 'none'
            }}></div>

            {/* Title */}
            <h1 style={{
                fontFamily: '"Times New Roman", serif',
                color: '#fbbf24', // Gold text
                fontSize: '3rem',
                textShadow: '0 2px 4px rgba(0,0,0,0.5)',
                margin: '0 0 1rem 0',
                lineHeight: 1.1,
                borderBottom: '1px solid rgba(251, 191, 36, 0.5)',
                paddingBottom: '1rem',
                width: '80%'
            }}>
                The Lingo<br />Dictionary
            </h1>

            {/* Subtitle */}
            <p style={{
                fontFamily: '"Merriweather", serif',
                color: '#fcd34d', // Lighter Gold
                fontSize: '1.1rem',
                fontStyle: 'italic',
                opacity: 0.9,
                margin: 0
            }}>
                A documentation of our semantic drift
            </p>

            <div style={{ marginTop: 'auto', textAlign: 'center' }}>
                <p style={{
                    fontFamily: '"Times New Roman", serif',
                    color: '#fcd34d',
                    fontSize: '1.2rem',
                    marginBottom: '1rem'
                }}>
                    Nancy Wang & Douglas Jiang
                </p>
                <p style={{ color: '#fbbf24', fontSize: '0.7rem', opacity: 0.6, letterSpacing: '2px', margin: 0 }}>
                    CLICK TO OPEN
                </p>
            </div>
        </div>
    );

    return (
        <div style={{
            position: 'relative', // Ensure absolute children are contained
            minHeight: '100vh',
            background: currentBg,
            padding: '2rem 1rem',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: isBookOpen ? 'flex-start' : 'center', // Center cover if closed
            fontFamily: '"Merriweather", "Times New Roman", serif',
            overflowX: 'hidden',
            perspective: '2000px' // For 3D effects
        }}>
            <style>
                {`
                    @keyframes bookOpen {
                        0% { transform: scale(0.8); opacity: 0; }
                        100% { transform: scale(1); opacity: 1; }
                    }
                    .animate-book-open {
                        animation: bookOpen 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
                    }
                `}
            </style>

            {/* Back Button - Always Visible */}
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
                    color: '#be185d', // Always Pink
                    transition: 'transform 0.2s',
                    padding: '0.5rem',
                    lineHeight: 1,
                    zIndex: 20,
                }}
                onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.1)'}
                onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
                title="Back to Home"
            >
                ←
            </button>

            {/* Close Book Button - Visible only when Open */}
            {isBookOpen && (
                <button
                    onClick={() => setIsBookOpen(false)}
                    style={{
                        position: 'absolute',
                        top: '2rem',
                        right: '2rem',
                        background: 'transparent',
                        border: 'none',
                        color: '#be185d',
                        cursor: 'pointer',
                        fontSize: '1rem',
                        fontWeight: 'bold',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        zIndex: 20
                    }}
                    title="Close Book"
                >
                    Close Book ✖
                </button>
            )}

            {!isBookOpen ? (
                /* CLOSED BOOK STATE */
                <BookCover />
            ) : (
                /* OPEN BOOK STATE */
                <div className="animate-book-open" style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
                    {/* Close Book Button */}



                    {/* Controls (Floating above book) */}
                    <div style={{ marginBottom: '2rem', width: '100%', maxWidth: '1000px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                        <div>
                            <h1 style={{ margin: 0, fontSize: '2rem', color: '#1f2937' }}>The Lingo Dictionaory</h1>
                            <p style={{ margin: '0.5rem 0 0 0', color: '#6b7280', fontSize: '1rem', fontStyle: 'italic', fontFamily: '"Times New Roman", serif' }}>
                                A documentation of our semantic drift
                            </p>
                        </div>
                        <div style={{ display: 'flex', gap: '1rem' }}>
                            <input
                                type="text"
                                placeholder="Search..."
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                style={{ padding: '0.8rem', borderRadius: '4px', border: '1px solid #ccc', minWidth: '200px' }}
                            />
                            <button
                                onClick={() => {
                                    setEditingId(null);
                                    setEditingId(null);
                                    setNewWord('');
                                    setMeanings([{ id: Date.now(), partOfSpeech: 'noun', definition: '', example: '' }]);
                                    setIsModalOpen(true);
                                }}
                                style={{ background: '#be185d', color: 'white', border: 'none', padding: '0.8rem 1.5rem', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}
                            >
                                + Add Word
                            </button>
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
                        {/* Navigation Buttons */}
                        {pageIndex > 0 && (
                            <button
                                onClick={prevPage}
                                style={{
                                    position: 'absolute',
                                    left: '-60px',
                                    top: '50%',
                                    transform: 'translateY(-50%)',
                                    background: 'white',
                                    border: 'none',
                                    borderRadius: '50%',
                                    width: '40px',
                                    height: '40px',
                                    boxShadow: '0 4px 10px rgba(0,0,0,0.1)',
                                    cursor: 'pointer',
                                    fontSize: '1.2rem',
                                    color: '#be185d'
                                }}
                            >
                                ◀
                            </button>
                        )}
                        {pageIndex < totalViews - 1 && (
                            <button
                                onClick={nextPage}
                                style={{
                                    position: 'absolute',
                                    right: '-60px',
                                    top: '50%',
                                    transform: 'translateY(-50%)',
                                    background: 'white',
                                    border: 'none',
                                    borderRadius: '50%',
                                    width: '40px',
                                    height: '40px',
                                    boxShadow: '0 4px 10px rgba(0,0,0,0.1)',
                                    cursor: 'pointer',
                                    fontSize: '1.2rem',
                                    color: '#be185d'
                                }}
                            >
                                ▶
                            </button>
                        )}
                        {/* Left Page */}
                        <div style={{
                            flex: 1,
                            padding: '3rem 4rem 3rem 3rem',
                            borderRight: '1px solid rgba(0,0,0,0.1)',
                            position: 'relative',
                            overflow: 'hidden' // No scroll
                        }}>
                            {/* Header */}
                            <div style={{ position: 'absolute', top: '1rem', left: '3rem', fontSize: '0.9rem', color: '#999', fontWeight: 'bold' }}>
                                {getGuideLetter(leftEntries, 'start')}
                            </div>

                            <div style={{ columnCount: 1 }}> {/* Per user request: 1 column per page */}
                                {leftEntries.map(entry => <BookEntry key={entry.id} entry={entry} />)}
                                {leftEntries.length === 0 && <p style={{ color: '#ccc', textAlign: 'center', marginTop: '4rem' }}></p>}
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
                            overflow: 'hidden' // No scroll
                        }}>
                            {/* Header */}
                            <div style={{ position: 'absolute', top: '1rem', right: '3rem', fontSize: '0.9rem', color: '#999', fontWeight: 'bold' }}>
                                {getGuideLetter(rightEntries, 'end')}
                            </div>

                            <div style={{ columnCount: 1 }}>
                                {rightEntries.map(entry => <BookEntry key={entry.id} entry={entry} />)}
                                {rightEntries.length === 0 && <p style={{ color: '#ccc', textAlign: 'center', marginTop: '4rem' }}></p>}
                            </div>
                        </div>
                    </div>



                    {/* Add Word Modal */}
                    {isModalOpen && (
                        <div style={{
                            position: 'fixed',
                            top: 0,
                            left: 0,
                            width: '100%',
                            height: '100%',
                            background: 'rgba(0,0,0,0.5)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            zIndex: 1000
                        }}>
                            <div style={{
                                background: 'white',
                                padding: '2rem',
                                borderRadius: '8px',
                                width: '90%',
                                maxWidth: '500px',
                                boxShadow: '0 10px 25px rgba(0,0,0,0.2)'
                            }}>
                                <h2 style={{ marginTop: 0, marginBottom: '1.5rem', color: '#1f2937' }}>
                                    {editingId ? 'Edit Word' : 'Add New Word'}
                                </h2>

                                <div style={{ marginBottom: '1rem' }}>
                                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold', color: '#4b5563' }}>Word</label>
                                    <input
                                        type="text"
                                        value={newWord}
                                        onChange={e => setNewWord(e.target.value)}
                                        style={{ width: '100%', padding: '0.8rem', borderRadius: '4px', border: '1px solid #d1d5db' }}
                                        placeholder="e.g. Feline"
                                    />
                                </div>

                                <div style={{ maxHeight: '60vh', overflowY: 'auto', paddingRight: '0.5rem' }}>
                                    {meanings.map((meaning, index) => (
                                        <div key={meaning.id} style={{ background: '#f9fafb', padding: '1rem', borderRadius: '8px', marginBottom: '1rem', border: '1px solid #e5e7eb' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                                                <span style={{ fontWeight: 'bold', color: '#be185d' }}>Meaning {index + 1}</span>
                                                {meanings.length > 1 && (
                                                    <button
                                                        onClick={() => setMeanings(meanings.filter(m => m.id !== meaning.id))}
                                                        style={{ color: '#ef4444', border: 'none', background: 'none', cursor: 'pointer', fontWeight: 'bold' }}
                                                    >
                                                        Remove
                                                    </button>
                                                )}
                                            </div>

                                            <div style={{ marginBottom: '1rem' }}>
                                                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold', color: '#4b5563' }}>Part of Speech</label>
                                                <select
                                                    value={meaning.partOfSpeech}
                                                    onChange={e => {
                                                        const newMeanings = [...meanings];
                                                        newMeanings[index].partOfSpeech = e.target.value;
                                                        setMeanings(newMeanings);
                                                    }}
                                                    style={{ width: '100%', padding: '0.8rem', borderRadius: '4px', border: '1px solid #d1d5db', background: 'white' }}
                                                >
                                                    <option value="noun">Noun</option>
                                                    <option value="verb">Verb</option>
                                                    <option value="adjective">Adjective</option>
                                                    <option value="adverb">Adverb</option>
                                                    <option value="preposition">Preposition</option>
                                                    <option value="conjunction">Conjunction</option>
                                                    <option value="interjection">Interjection</option>
                                                    <option value="phrase">Phrase</option>
                                                    <option value="idiom">Idiom</option>
                                                    <option value="emoji">Emoji</option>
                                                    <option value="term of endearment">Term of Endearment</option>
                                                </select>
                                            </div>

                                            <div style={{ marginBottom: '1rem' }}>
                                                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold', color: '#4b5563' }}>Definition</label>
                                                <textarea
                                                    value={meaning.definition}
                                                    onChange={e => {
                                                        const newMeanings = [...meanings];
                                                        newMeanings[index].definition = e.target.value;
                                                        setMeanings(newMeanings);
                                                    }}
                                                    rows="3"
                                                    style={{ width: '100%', padding: '0.8rem', borderRadius: '4px', border: '1px solid #d1d5db', resize: 'vertical' }}
                                                    placeholder="e.g. relating to or affecting cats or other members of the cat family."
                                                />
                                            </div>

                                            <div style={{ marginBottom: '0.5rem' }}>
                                                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold', color: '#4b5563' }}>Example Sentence</label>
                                                <textarea
                                                    value={meaning.example}
                                                    onChange={e => {
                                                        const newMeanings = [...meanings];
                                                        newMeanings[index].example = e.target.value;
                                                        setMeanings(newMeanings);
                                                    }}
                                                    rows="2"
                                                    style={{ width: '100%', padding: '0.8rem', borderRadius: '4px', border: '1px solid #d1d5db', resize: 'vertical' }}
                                                    placeholder="e.g. She treads the bed with a feline grace."
                                                />
                                            </div>
                                        </div>
                                    ))}

                                    <button
                                        onClick={() => setMeanings([...meanings, { id: Date.now(), partOfSpeech: 'noun', definition: '', example: '' }])}
                                        style={{ width: '100%', padding: '0.8rem', border: '2px dashed #d1d5db', borderRadius: '8px', background: 'none', color: '#6b7280', cursor: 'pointer', fontWeight: 'bold' }}
                                    >
                                        + Add Another Meaning
                                    </button>
                                </div>

                                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '2rem' }}>
                                    <button
                                        onClick={() => {
                                            setIsModalOpen(false);
                                            setEditingId(null);
                                            setNewWord('');
                                            setMeanings([{ id: Date.now(), partOfSpeech: 'noun', definition: '', example: '' }]);
                                        }}
                                        style={{ padding: '0.8rem 1.5rem', borderRadius: '4px', border: '1px solid #d1d5db', background: 'white', cursor: 'pointer', fontWeight: 'bold', color: '#4b5563' }}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={async () => {
                                            if (!newWord.trim()) return;

                                            if (editingId) {
                                                await updateDoc(doc(db, 'users', user.uid, 'nancy_dictionary', editingId), {
                                                    word: newWord.trim(),
                                                    meanings: meanings,
                                                    updatedAt: serverTimestamp()
                                                });
                                            } else {
                                                await addDoc(collection(db, 'users', user.uid, 'nancy_dictionary'), {
                                                    word: newWord.trim(),
                                                    meanings: meanings,
                                                    createdAt: serverTimestamp()
                                                });
                                            }

                                            setNewWord('');
                                            setMeanings([{ id: Date.now(), partOfSpeech: 'noun', definition: '', example: '' }]);
                                            setEditingId(null);
                                            setIsModalOpen(false);
                                        }}
                                        style={{ padding: '0.8rem 1.5rem', borderRadius: '4px', border: 'none', background: '#be185d', color: 'white', cursor: 'pointer', fontWeight: 'bold' }}
                                    >
                                        Save Word
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default NancyDictionary;
