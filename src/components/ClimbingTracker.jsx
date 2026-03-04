import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
    collection,
    query,
    orderBy,
    onSnapshot,
    addDoc,
    serverTimestamp,
    deleteDoc,
    doc,
    writeBatch
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

const getDefaultGradeByType = (type) => {
    if (type === 'boulder') return 'V3';
    if (type === 'speed') return '';
    return '5.10a';
};

const getGradesForType = (type) => {
    if (type === 'boulder') return V_GRADES;
    if (type === 'speed') return [];
    return YDS_GRADES;
};

const createBulkCounts = (type) => {
    return getGradesForType(type).reduce((acc, grade) => {
        acc[grade] = '';
        return acc;
    }, {});
};

const createSessionId = () => {
    if (typeof window !== 'undefined' && window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID();
    }
    return `session_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
};

const BATCH_CHUNK_SIZE = 450;
const GOOGLE_PLACES_SCRIPT_ID = 'google-places-maps-script';
const GOOGLE_PLACES_API_KEY = process.env.REACT_APP_GOOGLE_MAPS_API_KEY;

let googlePlacesScriptPromise = null;

const getPreferredCountryCode = () => {
    if (typeof navigator === 'undefined') return 'us';
    const locale = navigator.language || navigator.languages?.[0] || '';
    const match = locale.match(/-([A-Za-z]{2})$/);
    return (match?.[1] || 'us').toLowerCase();
};

const loadGooglePlacesScript = (apiKey) => {
    if (typeof window === 'undefined') {
        return Promise.reject(new Error('Window unavailable'));
    }

    if (window.google?.maps?.places) {
        return Promise.resolve();
    }

    if (!apiKey) {
        return Promise.reject(new Error('Missing Google Maps API key'));
    }

    if (googlePlacesScriptPromise) {
        return googlePlacesScriptPromise;
    }

    googlePlacesScriptPromise = new Promise((resolve, reject) => {
        const existingScript = document.getElementById(GOOGLE_PLACES_SCRIPT_ID);
        if (existingScript) {
            existingScript.addEventListener('load', () => resolve(), { once: true });
            existingScript.addEventListener('error', () => {
                googlePlacesScriptPromise = null;
                reject(new Error('Failed to load Google Places script'));
            }, { once: true });
            return;
        }

        const script = document.createElement('script');
        script.id = GOOGLE_PLACES_SCRIPT_ID;
        script.async = true;
        script.defer = true;
        script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places`;
        script.onload = () => resolve();
        script.onerror = () => {
            googlePlacesScriptPromise = null;
            reject(new Error('Failed to load Google Places script'));
        };
        document.head.appendChild(script);
    });

    return googlePlacesScriptPromise;
};

const getBarColorByType = (type, grade) => {
    if (type === 'boulder') {
        const index = V_GRADES.indexOf(grade);
        if (index < 3) return '#4ade80';
        if (index < 6) return '#fbbf24';
        if (index < 9) return '#f87171';
        return '#a855f7';
    }

    if (grade.startsWith('5.6') || grade.startsWith('5.7') || grade.startsWith('5.8') || grade.startsWith('5.9')) return '#4ade80';
    if (grade.startsWith('5.10') || grade.startsWith('5.11')) return '#fbbf24';
    if (grade.startsWith('5.12') || grade.startsWith('5.13')) return '#f87171';
    return '#a855f7';
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
    const [selectedGrade, setSelectedGrade] = useState(() => getDefaultGradeByType('boulder'));
    const [logDate, setLogDate] = useState(getLocalToday());
    const [logTime, setLogTime] = useState(''); // For Speed Climbing (seconds)
    const [logMode, setLogMode] = useState('single'); // 'single' | 'session'
    const [bulkCounts, setBulkCounts] = useState(() => createBulkCounts('boulder'));
    const [gymQuery, setGymQuery] = useState('');
    const [gymSuggestions, setGymSuggestions] = useState([]);
    const [selectedGym, setSelectedGym] = useState(null);
    const [gymLoading, setGymLoading] = useState(false);
    const [gymError, setGymError] = useState('');
    const [placesReady, setPlacesReady] = useState(false);
    const [placesLoading, setPlacesLoading] = useState(false);
    const autocompleteServiceRef = useRef(null);
    const placesServiceRef = useRef(null);
    const placesContainerRef = useRef(null);
    const gymSearchRequestRef = useRef(0);
    const countryCodeRef = useRef(getPreferredCountryCode());

    const resetGymState = () => {
        setGymQuery('');
        setGymSuggestions([]);
        setSelectedGym(null);
        setGymLoading(false);
        setGymError('');
    };

    // Reset grade when type changes
    useEffect(() => {
        setSelectedGrade(getDefaultGradeByType(climbType));
        setBulkCounts(createBulkCounts(climbType));
        if (climbType === 'speed') setLogMode('single');
    }, [climbType]);

    useEffect(() => {
        if (!showLogModal) return;

        if (!GOOGLE_PLACES_API_KEY) {
            setPlacesReady(false);
            setPlacesLoading(false);
            setGymSuggestions([]);
            setGymError('Gym search unavailable: add REACT_APP_GOOGLE_MAPS_API_KEY to enable Google Places.');
            return;
        }

        let isActive = true;
        setPlacesLoading(true);

        loadGooglePlacesScript(GOOGLE_PLACES_API_KEY)
            .then(() => {
                if (!isActive) return;
                if (!window.google?.maps?.places) {
                    setPlacesReady(false);
                    setGymError('Gym search is unavailable right now. You can still save without a gym.');
                    return;
                }

                if (!placesContainerRef.current) {
                    const container = document.createElement('div');
                    container.style.display = 'none';
                    document.body.appendChild(container);
                    placesContainerRef.current = container;
                }

                autocompleteServiceRef.current = new window.google.maps.places.AutocompleteService();
                placesServiceRef.current = new window.google.maps.places.PlacesService(placesContainerRef.current);
                setPlacesReady(true);
                setGymError('');
            })
            .catch((error) => {
                if (!isActive) return;
                console.error('Google Places initialization failed:', error);
                setPlacesReady(false);
                setGymError('Gym search is unavailable right now. You can still save without a gym.');
            })
            .finally(() => {
                if (isActive) setPlacesLoading(false);
            });

        return () => {
            isActive = false;
        };
    }, [showLogModal]);

    useEffect(() => {
        if (!showLogModal || !placesReady || !autocompleteServiceRef.current) return;

        const queryText = gymQuery.trim();
        if (queryText.length < 2) {
            setGymSuggestions([]);
            setGymLoading(false);
            return;
        }

        if (selectedGym && queryText === selectedGym.name) {
            setGymSuggestions([]);
            setGymLoading(false);
            return;
        }

        const requestId = gymSearchRequestRef.current + 1;
        gymSearchRequestRef.current = requestId;
        setGymLoading(true);

        const timeoutId = window.setTimeout(() => {
            const placesStatus = window.google?.maps?.places?.PlacesServiceStatus;
            if (!placesStatus) {
                setGymLoading(false);
                setGymSuggestions([]);
                setGymError('Gym search is unavailable right now. You can still save without a gym.');
                return;
            }

            const mapPredictions = (predictions) => (
                predictions.slice(0, 6).map((prediction) => ({
                    placeId: prediction.place_id,
                    description: prediction.description,
                    primaryText: prediction.structured_formatting?.main_text || prediction.description,
                    secondaryText: prediction.structured_formatting?.secondary_text || ''
                }))
            );

            const handlePredictionResult = (predictions, status, allowFallback) => {
                if (gymSearchRequestRef.current !== requestId) return;

                if (status === placesStatus.OK && predictions?.length) {
                    setGymLoading(false);
                    setGymError('');
                    setGymSuggestions(mapPredictions(predictions));
                    return;
                }

                if (status === placesStatus.ZERO_RESULTS && allowFallback) {
                    autocompleteServiceRef.current.getPlacePredictions(
                        {
                            input: queryText,
                            types: ['establishment']
                        },
                        (fallbackPredictions, fallbackStatus) => handlePredictionResult(fallbackPredictions, fallbackStatus, false)
                    );
                    return;
                }

                setGymLoading(false);
                if (status === placesStatus.ZERO_RESULTS) {
                    setGymSuggestions([]);
                    setGymError('');
                    return;
                }

                setGymSuggestions([]);
                setGymError('Could not load gym suggestions. You can still save without a gym.');
            };

            autocompleteServiceRef.current.getPlacePredictions(
                {
                    input: queryText,
                    types: ['establishment'],
                    componentRestrictions: { country: countryCodeRef.current }
                },
                (predictions, status) => handlePredictionResult(predictions, status, true)
            );
        }, 180);

        return () => {
            clearTimeout(timeoutId);
        };
    }, [gymQuery, placesReady, selectedGym, showLogModal]);

    useEffect(() => {
        return () => {
            if (placesContainerRef.current?.parentNode) {
                placesContainerRef.current.parentNode.removeChild(placesContainerRef.current);
            }
        };
    }, []);

    const totalBulkClimbs = React.useMemo(() => {
        return Object.values(bulkCounts).reduce((sum, value) => {
            const parsed = Number.parseInt(value, 10);
            return sum + (Number.isFinite(parsed) ? parsed : 0);
        }, 0);
    }, [bulkCounts]);

    // Graph Color Helper
    // Graph Color Helper
    const getBarColor = (grade) => getBarColorByType(climbType, grade);

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

    const openLogModal = () => {
        setLogMode('single');
        setSelectedGrade(getDefaultGradeByType(climbType));
        setLogTime('');
        setLogDate(getLocalToday());
        setBulkCounts(createBulkCounts(climbType));
        resetGymState();
        setShowLogModal(true);
    };

    const closeLogModal = () => {
        setShowLogModal(false);
        setLogMode('single');
        setSelectedGrade(getDefaultGradeByType(climbType));
        setLogTime('');
        setLogDate(getLocalToday());
        setBulkCounts(createBulkCounts(climbType));
        resetGymState();
    };

    const handleSelectGymSuggestion = (suggestion) => {
        if (!suggestion?.placeId || !placesServiceRef.current || !window.google?.maps?.places) {
            setSelectedGym({
                placeId: suggestion?.placeId || '',
                name: suggestion?.primaryText || suggestion?.description || gymQuery.trim(),
                address: suggestion?.secondaryText || '',
                lat: null,
                lng: null
            });
            setGymQuery(suggestion?.primaryText || suggestion?.description || gymQuery.trim());
            setGymSuggestions([]);
            return;
        }

        setGymLoading(true);
        placesServiceRef.current.getDetails(
            {
                placeId: suggestion.placeId,
                fields: ['place_id', 'name', 'formatted_address', 'geometry.location']
            },
            (place, status) => {
                setGymLoading(false);
                const placesStatus = window.google?.maps?.places?.PlacesServiceStatus;
                if (status !== placesStatus?.OK || !place) {
                    setSelectedGym({
                        placeId: suggestion.placeId,
                        name: suggestion.primaryText || suggestion.description,
                        address: suggestion.secondaryText || '',
                        lat: null,
                        lng: null
                    });
                    setGymQuery(suggestion.primaryText || suggestion.description);
                    setGymSuggestions([]);
                    setGymError('Gym details were partially unavailable. Name will still be saved.');
                    return;
                }

                const rawLat = place.geometry?.location?.lat?.();
                const rawLng = place.geometry?.location?.lng?.();
                setSelectedGym({
                    placeId: place.place_id || suggestion.placeId,
                    name: place.name || suggestion.primaryText || suggestion.description,
                    address: place.formatted_address || suggestion.secondaryText || '',
                    lat: Number.isFinite(rawLat) ? rawLat : null,
                    lng: Number.isFinite(rawLng) ? rawLng : null
                });
                setGymQuery(place.name || suggestion.primaryText || suggestion.description);
                setGymSuggestions([]);
                setGymError('');
            }
        );
    };

    const clearSelectedGym = () => {
        setSelectedGym(null);
        setGymQuery('');
        setGymSuggestions([]);
        setGymError('');
    };

    const updateBulkCount = (grade, rawValue) => {
        if (rawValue === '') {
            setBulkCounts(prev => ({ ...prev, [grade]: '' }));
            return;
        }
        if (!/^\d+$/.test(rawValue)) return;

        const parsed = Math.max(0, Number.parseInt(rawValue, 10));
        setBulkCounts(prev => ({ ...prev, [grade]: String(parsed) }));
    };

    const handleLogClimb = async () => {
        if (!user) return;
        try {
            // Create a proper date object from the input string (YYYY-MM-DD)
            // We set time to noon to avoid timezone rolling issues
            const [y, m, d] = logDate.split('-').map(Number);
            if (!y || !m || !d) return;
            const dateObj = new Date(y, m - 1, d, 12, 0, 0, 0);
            const dateKey = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const historyRef = collection(db, 'users', user.uid, 'climbing_history');
            const gymPayload = {};
            if (selectedGym) {
                if (selectedGym.placeId) gymPayload.gymPlaceId = selectedGym.placeId;
                if (selectedGym.name) gymPayload.gymName = selectedGym.name;
                if (selectedGym.address) gymPayload.gymAddress = selectedGym.address;
                if (Number.isFinite(selectedGym.lat)) gymPayload.gymLat = selectedGym.lat;
                if (Number.isFinite(selectedGym.lng)) gymPayload.gymLng = selectedGym.lng;
                gymPayload.gymSource = 'google_places';
            }

            if (logMode === 'single' || climbType === 'speed') {
                const parsedTime = Number.parseFloat(logTime);
                if (climbType === 'speed' && (!Number.isFinite(parsedTime) || parsedTime <= 0)) return;

                await addDoc(historyRef, {
                    type: climbType,
                    grade: climbType === 'speed' ? null : selectedGrade,
                    time: climbType === 'speed' ? parsedTime : null,
                    date: dateObj,
                    createdAt: serverTimestamp(),
                    sessionId: createSessionId(),
                    entryMode: 'single',
                    dateKey,
                    ...gymPayload
                });
            } else {
                const grades = getGradesForType(climbType);
                const entries = [];

                grades.forEach((grade) => {
                    const parsed = Number.parseInt(bulkCounts[grade], 10);
                    const count = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
                    for (let i = 0; i < count; i += 1) {
                        entries.push(grade);
                    }
                });

                if (entries.length === 0) return;

                const sessionId = createSessionId();
                for (let start = 0; start < entries.length; start += BATCH_CHUNK_SIZE) {
                    const batch = writeBatch(db);
                    const chunk = entries.slice(start, start + BATCH_CHUNK_SIZE);

                    chunk.forEach((grade) => {
                        const ref = doc(historyRef);
                        batch.set(ref, {
                            type: climbType,
                            grade,
                            time: null,
                            date: dateObj,
                            createdAt: serverTimestamp(),
                            sessionId,
                            entryMode: 'session',
                            dateKey,
                            ...gymPayload
                        });
                    });

                    await batch.commit();
                }
            }

            closeLogModal();
        } catch (error) {
            console.error("Error logging climb:", error);
        }
    };

    const historyRows = React.useMemo(() => {
        return climbs.filter((climb) => (climb.type || 'boulder') === climbType);
    }, [climbs, climbType]);

    const handleDeleteLog = async (id) => {
        if (!user || !id) return;
        if (!window.confirm('Delete this log?')) return;
        try {
            await deleteDoc(doc(db, 'users', user.uid, 'climbing_history', id));
        } catch (err) {
            console.error(err);
        }
    };

    const parsedSpeedTime = Number.parseFloat(logTime);
    const canSaveSingle = climbType === 'speed'
        ? Number.isFinite(parsedSpeedTime) && parsedSpeedTime > 0
        : Boolean(selectedGrade);
    const canSave = logMode === 'session' && climbType !== 'speed'
        ? totalBulkClimbs > 0
        : canSaveSingle;

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
                <button className="log-climb-btn full-width" onClick={openLogModal}>
                    + Log Climb
                </button>
            </div>

            {/* LOG MODAL */}
            {
                showLogModal && createPortal(
                    <div className="climb-modal-overlay" onClick={closeLogModal}>
                        <div className="climb-modal climb-log-modal" onClick={e => e.stopPropagation()}>
                            <h3>Log Sent Climb</h3>
                            <div className="climb-log-modal-content">
                                <div className="climb-log-mode-tabs">
                                    <button
                                        type="button"
                                        className={`climb-log-mode-tab ${logMode === 'single' ? 'active' : ''}`}
                                        onClick={() => setLogMode('single')}
                                    >
                                        Single
                                    </button>
                                    <button
                                        type="button"
                                        className={`climb-log-mode-tab ${logMode === 'session' ? 'active' : ''}`}
                                        onClick={() => setLogMode('session')}
                                        disabled={climbType === 'speed'}
                                    >
                                        Session
                                    </button>
                                </div>

                                {climbType === 'speed' && (
                                    <p className="climb-log-mode-note">
                                        Session bulk logging is not available for Speed yet.
                                    </p>
                                )}

                                <div className="form-group">
                                    <label>Date Sent</label>
                                    <input
                                        type="date"
                                        value={logDate}
                                        onChange={(e) => setLogDate(e.target.value)}
                                        className="climb-date-input"
                                    />
                                </div>

                                <div className="form-group">
                                    <label>Gym (optional)</label>
                                    <div className="gym-search-field">
                                        <input
                                            type="text"
                                            value={gymQuery}
                                            onChange={(e) => {
                                                const nextValue = e.target.value;
                                                setGymQuery(nextValue);
                                                setGymError('');
                                                if (selectedGym && nextValue !== selectedGym.name) {
                                                    setSelectedGym(null);
                                                }
                                            }}
                                            placeholder={
                                                placesReady
                                                    ? 'Search climbing gym...'
                                                    : 'Gym search unavailable (optional)'
                                            }
                                            className="climb-date-input gym-search-input"
                                            autoComplete="off"
                                        />
                                        {selectedGym && (
                                            <button
                                                type="button"
                                                className="gym-clear-btn"
                                                onClick={clearSelectedGym}
                                            >
                                                Clear
                                            </button>
                                        )}
                                    </div>

                                    {gymLoading && <div className="gym-helper-text">Searching gyms...</div>}

                                    {placesReady && gymSuggestions.length > 0 && (
                                        <div className="gym-suggestions" role="listbox">
                                            {gymSuggestions.map((suggestion) => (
                                                <button
                                                    type="button"
                                                    key={suggestion.placeId}
                                                    className="gym-suggestion-btn"
                                                    onClick={() => handleSelectGymSuggestion(suggestion)}
                                                >
                                                    <span className="gym-suggestion-primary">{suggestion.primaryText}</span>
                                                    {suggestion.secondaryText && (
                                                        <span className="gym-suggestion-secondary">{suggestion.secondaryText}</span>
                                                    )}
                                                </button>
                                            ))}
                                        </div>
                                    )}

                                    {selectedGym && (
                                        <div className="selected-gym-chip">
                                            <span className="selected-gym-name">{selectedGym.name}</span>
                                            {selectedGym.address && (
                                                <span className="selected-gym-address">{selectedGym.address}</span>
                                            )}
                                        </div>
                                    )}

                                    {placesLoading && !gymLoading && (
                                        <div className="gym-helper-text">Loading gym search...</div>
                                    )}

                                    {gymError && (
                                        <div className="gym-helper-text error">{gymError}</div>
                                    )}
                                </div>

                                {(logMode === 'single' || climbType === 'speed') ? (
                                    <div className="form-group">
                                        <label>{climbType === 'speed' ? 'Time (seconds)' : 'Grade'}</label>
                                        {climbType === 'speed' ? (
                                            <input
                                                type="number"
                                                placeholder="e.g. 15.4"
                                                value={logTime}
                                                onChange={(e) => setLogTime(e.target.value)}
                                                className="climb-date-input"
                                                autoFocus
                                                step="0.01"
                                                min="0"
                                            />
                                        ) : (
                                            <div className="grade-grid">
                                                {getGradesForType(climbType).map(g => (
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
                                ) : (
                                    <div className="form-group session-form-group">
                                        <label>Climbs by Grade</label>
                                        <div className="session-grade-grid-scroll">
                                            <div className="session-grade-grid">
                                                {getGradesForType(climbType).map((grade) => (
                                                    <label
                                                        className="session-grade-row"
                                                        key={grade}
                                                        style={{
                                                            borderColor: `${getBarColor(grade)}33`,
                                                            backgroundColor: `${getBarColor(grade)}10`
                                                        }}
                                                    >
                                                        <span
                                                            className="session-grade-label"
                                                            style={{
                                                                color: getBarColor(grade),
                                                                backgroundColor: `${getBarColor(grade)}1a`
                                                            }}
                                                        >
                                                            {grade}
                                                        </span>
                                                        <input
                                                            type="number"
                                                            min="0"
                                                            step="1"
                                                            inputMode="numeric"
                                                            className="session-count-input"
                                                            value={bulkCounts[grade] ?? ''}
                                                            onChange={(e) => updateBulkCount(grade, e.target.value)}
                                                            placeholder="0"
                                                        />
                                                    </label>
                                                ))}
                                            </div>
                                        </div>
                                        <div className="session-summary">
                                            Total climbs: <strong>{totalBulkClimbs}</strong>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="modal-actions">
                                <button className="cancel-btn" onClick={closeLogModal}>Cancel</button>
                                <button className="save-btn" onClick={handleLogClimb} disabled={!canSave}>
                                    {logMode === 'session' && climbType !== 'speed' ? 'Save Session' : 'Log It!'}
                                </button>
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
                                {historyRows.length === 0 ? (
                                    <p className="empty-message">No climbs logged yet. Go send some rocks!</p>
                                ) : (
                                    historyRows.map(climb => (
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
                                                <span className={`history-gym ${climb.gymName ? '' : 'empty'}`}>
                                                    {climb.gymName || 'No gym'}
                                                </span>
                                            </div>
                                            <button className="delete-log-btn" onClick={() => handleDeleteLog(climb.id)}>
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
