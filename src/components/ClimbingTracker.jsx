import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
    collection,
    query,
    orderBy,
    onSnapshot,
    doc,
    writeBatch,
    updateDoc,
    deleteDoc,
    deleteField,
    setDoc,
    serverTimestamp,
    getDoc,
    getDocs
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

const BATCH_CHUNK_SIZE = 450;
const ROUTE_REMARK_MAX = 140;
const SESSION_NOTE_MAX = 140;
const MIGRATION_VERSION = 1;
const GOOGLE_PLACES_SCRIPT_ID = 'google-places-maps-script';
const GOOGLE_PLACES_API_KEY = process.env.REACT_APP_GOOGLE_MAPS_API_KEY;

let googlePlacesScriptPromise = null;

const getLocalToday = () => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const getDateKeyFromTimestamp = (timestamp) => {
    const date = new Date(timestamp || Date.now());
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const formatDateKeyAsUs = (dateKey) => {
    if (typeof dateKey !== 'string') return '';
    const [y, m, d] = dateKey.split('-').map(Number);
    if (!y || !m || !d) return dateKey;
    return `${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}/${String(y).padStart(4, '0')}`;
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

const getGymCityFromAddress = (address) => {
    if (!address) return '';
    const parts = address.split(',').map((part) => part.trim()).filter(Boolean);
    return parts.length >= 2 ? parts[1] : '';
};

const getGymLabel = (session) => {
    const nickname = typeof session.gymNickname === 'string' ? session.gymNickname.trim() : '';
    if (nickname) return nickname;
    const name = typeof session.gymName === 'string' ? session.gymName.trim() : '';
    if (!name) return 'No gym';
    const city = getGymCityFromAddress(session.gymAddress);
    return city ? `${name}, ${city}` : name;
};

const buildGymPayload = (gym, nickname = '') => {
    if (!gym) return {};
    const payload = {};
    if (gym.placeId) payload.gymPlaceId = gym.placeId;
    if (gym.name) payload.gymName = gym.name;
    if (gym.address) payload.gymAddress = gym.address;
    if (Number.isFinite(gym.lat)) payload.gymLat = gym.lat;
    if (Number.isFinite(gym.lng)) payload.gymLng = gym.lng;
    const trimmedNickname = typeof nickname === 'string' ? nickname.trim() : '';
    if (trimmedNickname) payload.gymNickname = trimmedNickname;
    if (Object.keys(payload).length > 0) payload.gymSource = 'google_places';
    return payload;
};

const createBulkCounts = (type) => getGradesForType(type).reduce((acc, grade) => {
    acc[grade] = '';
    return acc;
}, {});

const normalizeDocId = (value) => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed || trimmed.includes('/')) return null;
    return trimmed;
};

const hashString = (value) => {
    const text = String(value || '');
    let hash = 5381;
    for (let i = 0; i < text.length; i += 1) {
        hash = ((hash << 5) + hash) + text.charCodeAt(i);
        hash |= 0;
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
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

const buildLegacySessionCards = (legacyClimbs) => {
    const grouped = new Map();

    legacyClimbs.forEach((climb) => {
        const timestamp = Number.isFinite(climb.timestamp) ? climb.timestamp : Date.now();
        const dateKey = climb.dateKey || getDateKeyFromTimestamp(timestamp);
        const type = climb.type || 'boulder';
        const fallbackKey = `${dateKey}|${type}|${climb.gymPlaceId || climb.gymName || 'nogym'}|legacy`;
        const key = normalizeDocId(climb.sessionId) || fallbackKey;

        if (!grouped.has(key)) {
            grouped.set(key, {
                id: key,
                type,
                dateKey,
                timestamp,
                gymPlaceId: climb.gymPlaceId || '',
                gymName: climb.gymName || '',
                gymAddress: climb.gymAddress || '',
                gymLat: Number.isFinite(climb.gymLat) ? climb.gymLat : null,
                gymLng: Number.isFinite(climb.gymLng) ? climb.gymLng : null,
                gymNickname: climb.gymNickname || '',
                sessionNote: '',
                legacy: true,
                climbs: []
            });
        }

        const group = grouped.get(key);
        if (timestamp > group.timestamp) {
            group.timestamp = timestamp;
            group.dateKey = dateKey;
        }

        group.climbs.push({
            id: climb.id,
            grade: climb.grade ?? null,
            time: Number.isFinite(Number.parseFloat(climb.time)) ? Number.parseFloat(climb.time) : null,
            remark: typeof climb.remark === 'string' ? climb.remark : '',
            order: Number.isFinite(climb.order) ? climb.order : group.climbs.length,
            legacy: true
        });
    });

    return Array.from(grouped.values())
        .map((session) => ({
            ...session,
            climbs: session.climbs.sort((a, b) => {
                const orderDiff = (a.order ?? 0) - (b.order ?? 0);
                if (orderDiff !== 0) return orderDiff;
                return String(a.id).localeCompare(String(b.id));
            })
        }))
        .sort((a, b) => b.timestamp - a.timestamp);
};

const commitSessionWithClimbs = async (sessionRef, sessionPayload, climbPayloads) => {
    const firstChunkSize = Math.max(1, BATCH_CHUNK_SIZE - 1);
    for (let start = 0; start < climbPayloads.length || start === 0; start += firstChunkSize) {
        const batch = writeBatch(db);
        if (start === 0) {
            batch.set(sessionRef, sessionPayload);
        }
        const chunk = climbPayloads.slice(start, start + firstChunkSize);
        chunk.forEach((climbEntry) => {
            const climbData = climbEntry?.data || climbEntry;
            const climbId = normalizeDocId(climbEntry?.id || '');
            const climbRef = climbId
                ? doc(sessionRef, 'climbs', climbId)
                : doc(collection(sessionRef, 'climbs'));
            batch.set(climbRef, climbData);
        });
        await batch.commit();
        if (climbPayloads.length <= firstChunkSize) break;
    }
};

const ClimbingTracker = () => {
    const { user } = useAuth();

    const [timeRange, setTimeRange] = useState('ALL');
    const [climbType, setClimbType] = useState('boulder');

    const [showLogModal, setShowLogModal] = useState(false);
    const [showHistoryModal, setShowHistoryModal] = useState(false);
    const [showEditSessionModal, setShowEditSessionModal] = useState(false);
    const [showEditClimbModal, setShowEditClimbModal] = useState(false);

    const [sessionsBase, setSessionsBase] = useState([]);
    const [climbsBySession, setClimbsBySession] = useState({});
    const [legacyClimbs, setLegacyClimbs] = useState([]);

    const [isMigrationChecked, setIsMigrationChecked] = useState(false);
    const [migrationCompleted, setMigrationCompleted] = useState(false);
    const [showMigrationModal, setShowMigrationModal] = useState(false);
    const [migrationRunning, setMigrationRunning] = useState(false);
    const [migrationError, setMigrationError] = useState('');
    const [migrationStats, setMigrationStats] = useState({ sessions: 0, climbs: 0 });

    const [selectedGrade, setSelectedGrade] = useState(() => getDefaultGradeByType('boulder'));
    const [logDate, setLogDate] = useState(getLocalToday());
    const [logTime, setLogTime] = useState('');
    const [logMode, setLogMode] = useState('single');
    const [bulkCounts, setBulkCounts] = useState(() => createBulkCounts('boulder'));
    const [logRouteRemark, setLogRouteRemark] = useState('');
    const [logSessionNote, setLogSessionNote] = useState('');

    const [gymNicknameMap, setGymNicknameMap] = useState({});

    const [gymQuery, setGymQuery] = useState('');
    const [gymSuggestions, setGymSuggestions] = useState([]);
    const [selectedGym, setSelectedGym] = useState(null);
    const [gymNickname, setGymNickname] = useState('');
    const [gymLoading, setGymLoading] = useState(false);
    const [gymError, setGymError] = useState('');

    const [editingSession, setEditingSession] = useState(null);
    const [editSessionDate, setEditSessionDate] = useState(getLocalToday());
    const [editSessionNote, setEditSessionNote] = useState('');
    const [isSavingSession, setIsSavingSession] = useState(false);

    const [editGymQuery, setEditGymQuery] = useState('');
    const [editGymSuggestions, setEditGymSuggestions] = useState([]);
    const [editSelectedGym, setEditSelectedGym] = useState(null);
    const [editGymNickname, setEditGymNickname] = useState('');
    const [editGymLoading, setEditGymLoading] = useState(false);
    const [editGymError, setEditGymError] = useState('');

    const [editingClimb, setEditingClimb] = useState(null);
    const [editingClimbSessionId, setEditingClimbSessionId] = useState('');
    const [editingClimbType, setEditingClimbType] = useState('boulder');
    const [editClimbGrade, setEditClimbGrade] = useState(() => getDefaultGradeByType('boulder'));
    const [editClimbTime, setEditClimbTime] = useState('');
    const [editClimbRemark, setEditClimbRemark] = useState('');
    const [editClimbError, setEditClimbError] = useState('');
    const [isSavingClimb, setIsSavingClimb] = useState(false);

    const [placesReady, setPlacesReady] = useState(false);
    const [placesLoading, setPlacesLoading] = useState(false);
    const autocompleteServiceRef = useRef(null);
    const placesServiceRef = useRef(null);
    const placesContainerRef = useRef(null);
    const gymSearchRequestRef = useRef(0);
    const editGymSearchRequestRef = useRef(0);
    const countryCodeRef = useRef(getPreferredCountryCode());

    const isLegacyMode = isMigrationChecked && !migrationCompleted;

    const resetLogGymState = () => {
        setGymQuery('');
        setGymSuggestions([]);
        setSelectedGym(null);
        setGymNickname('');
        setGymLoading(false);
        setGymError('');
    };

    const resetEditSessionGymState = () => {
        setEditGymQuery('');
        setEditGymSuggestions([]);
        setEditSelectedGym(null);
        setEditGymNickname('');
        setEditGymLoading(false);
        setEditGymError('');
    };

    useEffect(() => {
        setSelectedGrade(getDefaultGradeByType(climbType));
        setBulkCounts(createBulkCounts(climbType));
        if (climbType === 'speed') setLogMode('single');
    }, [climbType]);

    useEffect(() => {
        if (!user) {
            setGymNicknameMap({});
            return undefined;
        }

        const nicknamesRef = collection(db, 'users', user.uid, 'gym_nicknames');
        const unsub = onSnapshot(nicknamesRef, (snapshot) => {
            const nextMap = {};
            snapshot.docs.forEach((snapshotDoc) => {
                const data = snapshotDoc.data() || {};
                if (typeof data.placeId === 'string' && typeof data.nickname === 'string' && data.nickname.trim()) {
                    nextMap[data.placeId] = data.nickname.trim();
                }
            });
            setGymNicknameMap(nextMap);
        });

        return () => unsub();
    }, [user]);

    const getRememberedNickname = (placeId) => {
        if (!placeId) return '';
        return gymNicknameMap[placeId] || '';
    };

    const rememberGymNickname = async (gym, nickname) => {
        if (!user || !gym?.placeId) return;
        const trimmedNickname = typeof nickname === 'string' ? nickname.trim() : '';
        if (!trimmedNickname) return;

        try {
            await setDoc(
                doc(db, 'users', user.uid, 'gym_nicknames', gym.placeId),
                {
                    placeId: gym.placeId,
                    nickname: trimmedNickname,
                    gymName: gym.name || '',
                    gymAddress: gym.address || '',
                    updatedAt: serverTimestamp()
                },
                { merge: true }
            );
        } catch (error) {
            console.warn('Could not store gym nickname mapping:', error);
        }
    };

    useEffect(() => {
        if (!user) {
            setIsMigrationChecked(false);
            setMigrationCompleted(false);
            setShowMigrationModal(false);
            setMigrationRunning(false);
            setMigrationError('');
            setLegacyClimbs([]);
            return;
        }

        let isActive = true;

        const runCheck = async () => {
            setIsMigrationChecked(false);
            setMigrationError('');

            try {
                const markerRef = doc(db, 'users', user.uid, 'meta', 'climbing_migration');
                const markerSnap = await getDoc(markerRef);
                if (!isActive) return;

                if (markerSnap.exists() && markerSnap.data()?.version === MIGRATION_VERSION) {
                    setMigrationCompleted(true);
                    setShowMigrationModal(false);
                    setIsMigrationChecked(true);
                    return;
                }

                const legacyRef = collection(db, 'users', user.uid, 'climbing_history');
                const legacySnap = await getDocs(legacyRef);
                if (!isActive) return;

                if (legacySnap.empty) {
                    setMigrationCompleted(true);
                    setShowMigrationModal(false);
                    setIsMigrationChecked(true);
                } else {
                    setMigrationCompleted(false);
                    setShowMigrationModal(true);
                    setIsMigrationChecked(true);
                }
            } catch (error) {
                console.error('Migration check failed:', error);
                if (!isActive) return;
                setMigrationCompleted(false);
                setShowMigrationModal(true);
                setMigrationError('Could not check migration status. You can retry migration.');
                setIsMigrationChecked(true);
            }
        };

        runCheck();

        return () => {
            isActive = false;
        };
    }, [user]);

    useEffect(() => {
        if (!user || !isMigrationChecked || migrationCompleted) return undefined;

        const legacyRef = collection(db, 'users', user.uid, 'climbing_history');
        const unsub = onSnapshot(legacyRef, (snapshot) => {
            const next = snapshot.docs.map((snap) => {
                const data = snap.data() || {};
                const timestamp = data.date?.toMillis?.() || Date.now();
                return {
                    id: snap.id,
                    ...data,
                    timestamp,
                    dateKey: data.dateKey || getDateKeyFromTimestamp(timestamp)
                };
            }).sort((a, b) => b.timestamp - a.timestamp);
            setLegacyClimbs(next);
        });

        return () => unsub();
    }, [user, isMigrationChecked, migrationCompleted]);

    useEffect(() => {
        if (!user || !isMigrationChecked || !migrationCompleted) return undefined;

        const sessionsRef = collection(db, 'users', user.uid, 'climbing_sessions');
        const sessionsQuery = query(sessionsRef, orderBy('date', 'desc'));
        const unsub = onSnapshot(sessionsQuery, (snapshot) => {
            const next = snapshot.docs.map((snap) => {
                const data = snap.data() || {};
                const timestamp = data.date?.toMillis?.() || Date.now();
                return {
                    id: snap.id,
                    ...data,
                    timestamp,
                    dateKey: data.dateKey || getDateKeyFromTimestamp(timestamp)
                };
            });
            setSessionsBase(next);
        });

        return () => unsub();
    }, [user, isMigrationChecked, migrationCompleted]);

    useEffect(() => {
        if (!user || !migrationCompleted) return undefined;

        if (sessionsBase.length === 0) {
            setClimbsBySession({});
            return undefined;
        }

        const unsubs = sessionsBase.map((session) => {
            const climbsRef = collection(db, 'users', user.uid, 'climbing_sessions', session.id, 'climbs');
            const climbsQuery = query(climbsRef, orderBy('order', 'asc'));
            return onSnapshot(climbsQuery, (snapshot) => {
                const climbs = snapshot.docs.map((snap, index) => {
                    const data = snap.data() || {};
                    return {
                        id: snap.id,
                        ...data,
                        order: Number.isFinite(data.order) ? data.order : index
                    };
                });
                setClimbsBySession((prev) => ({ ...prev, [session.id]: climbs }));
            });
        });

        return () => {
            unsubs.forEach((unsub) => unsub());
        };
    }, [user, migrationCompleted, sessionsBase]);

    const activeSessions = useMemo(() => {
        if (migrationCompleted) {
            return sessionsBase.map((session) => ({
                ...session,
                legacy: false,
                climbs: climbsBySession[session.id] || []
            }));
        }
        return buildLegacySessionCards(legacyClimbs);
    }, [migrationCompleted, sessionsBase, climbsBySession, legacyClimbs]);

    const historySessions = useMemo(() => {
        return activeSessions
            .filter((session) => (session.type || 'boulder') === climbType)
            .sort((a, b) => b.timestamp - a.timestamp);
    }, [activeSessions, climbType]);

    const chartData = useMemo(() => {
        const now = Date.now();
        let cutoff = 0;
        if (timeRange === '1W') cutoff = now - 7 * 24 * 60 * 60 * 1000;
        if (timeRange === '1M') cutoff = now - 30 * 24 * 60 * 60 * 1000;
        if (timeRange === '1Y') cutoff = now - 365 * 24 * 60 * 60 * 1000;

        const filteredSessions = historySessions.filter((session) => session.timestamp >= cutoff);

        if (climbType === 'speed') {
            const points = [];
            filteredSessions
                .sort((a, b) => a.timestamp - b.timestamp)
                .forEach((session) => {
                    session.climbs.forEach((climb, index) => {
                        const time = Number.parseFloat(climb.time);
                        if (!Number.isFinite(time) || time <= 0) return;
                        points.push({
                            id: `${session.id}_${climb.id}`,
                            timestamp: session.timestamp + index,
                            time
                        });
                    });
                });
            return points;
        }

        const grades = climbType === 'boulder' ? V_GRADES : YDS_GRADES;
        const counts = grades.reduce((acc, grade) => {
            acc[grade] = 0;
            return acc;
        }, {});

        filteredSessions.forEach((session) => {
            session.climbs.forEach((climb) => {
                if (typeof climb.grade === 'string' && counts[climb.grade] !== undefined) {
                    counts[climb.grade] += 1;
                }
            });
        });

        return grades.map((grade) => ({ grade, count: counts[grade] || 0 })).filter((item) => item.count > 0 || timeRange === 'ALL');
    }, [historySessions, timeRange, climbType]);

    const totalBulkClimbs = useMemo(() => {
        return Object.values(bulkCounts).reduce((sum, value) => {
            const parsed = Number.parseInt(value, 10);
            return sum + (Number.isFinite(parsed) ? parsed : 0);
        }, 0);
    }, [bulkCounts]);

    const isGymLookupActive = showLogModal || showEditSessionModal;
    useEffect(() => {
        if (!isGymLookupActive) return;

        if (!GOOGLE_PLACES_API_KEY) {
            setPlacesReady(false);
            setPlacesLoading(false);
            if (showLogModal) {
                setGymSuggestions([]);
                setGymError('Gym search unavailable: add REACT_APP_GOOGLE_MAPS_API_KEY to enable Google Places.');
            }
            if (showEditSessionModal) {
                setEditGymSuggestions([]);
                setEditGymError('Gym search unavailable: add REACT_APP_GOOGLE_MAPS_API_KEY to enable Google Places.');
            }
            return;
        }

        let isActive = true;
        setPlacesLoading(true);

        loadGooglePlacesScript(GOOGLE_PLACES_API_KEY)
            .then(() => {
                if (!isActive) return;
                if (!window.google?.maps?.places) {
                    setPlacesReady(false);
                    if (showLogModal) setGymError('Gym search is unavailable right now. You can still save without a gym.');
                    if (showEditSessionModal) setEditGymError('Gym search is unavailable right now. You can still save without a gym.');
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
                if (showLogModal) setGymError('');
                if (showEditSessionModal) setEditGymError('');
            })
            .catch((error) => {
                if (!isActive) return;
                console.error('Google Places initialization failed:', error);
                setPlacesReady(false);
                if (showLogModal) setGymError('Gym search is unavailable right now. You can still save without a gym.');
                if (showEditSessionModal) setEditGymError('Gym search is unavailable right now. You can still save without a gym.');
            })
            .finally(() => {
                if (isActive) setPlacesLoading(false);
            });

        return () => {
            isActive = false;
        };
    }, [isGymLookupActive, showLogModal, showEditSessionModal]);

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

            const handleResult = (predictions, status, allowFallback) => {
                if (gymSearchRequestRef.current !== requestId) return;

                if (status === placesStatus.OK && predictions?.length) {
                    setGymLoading(false);
                    setGymError('');
                    setGymSuggestions(mapPredictions(predictions));
                    return;
                }

                if (status === placesStatus.ZERO_RESULTS && allowFallback) {
                    autocompleteServiceRef.current.getPlacePredictions(
                        { input: queryText, types: ['establishment'] },
                        (fallbackPredictions, fallbackStatus) => handleResult(fallbackPredictions, fallbackStatus, false)
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
                (predictions, status) => handleResult(predictions, status, true)
            );
        }, 180);

        return () => clearTimeout(timeoutId);
    }, [gymQuery, placesReady, selectedGym, showLogModal]);

    useEffect(() => {
        if (!showEditSessionModal || !placesReady || !autocompleteServiceRef.current) return;

        const queryText = editGymQuery.trim();
        if (queryText.length < 2) {
            setEditGymSuggestions([]);
            setEditGymLoading(false);
            return;
        }

        if (editSelectedGym && queryText === editSelectedGym.name) {
            setEditGymSuggestions([]);
            setEditGymLoading(false);
            return;
        }

        const requestId = editGymSearchRequestRef.current + 1;
        editGymSearchRequestRef.current = requestId;
        setEditGymLoading(true);

        const timeoutId = window.setTimeout(() => {
            const placesStatus = window.google?.maps?.places?.PlacesServiceStatus;
            if (!placesStatus) {
                setEditGymLoading(false);
                setEditGymSuggestions([]);
                setEditGymError('Gym search is unavailable right now. You can still save without a gym.');
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

            const handleResult = (predictions, status, allowFallback) => {
                if (editGymSearchRequestRef.current !== requestId) return;

                if (status === placesStatus.OK && predictions?.length) {
                    setEditGymLoading(false);
                    setEditGymError('');
                    setEditGymSuggestions(mapPredictions(predictions));
                    return;
                }

                if (status === placesStatus.ZERO_RESULTS && allowFallback) {
                    autocompleteServiceRef.current.getPlacePredictions(
                        { input: queryText, types: ['establishment'] },
                        (fallbackPredictions, fallbackStatus) => handleResult(fallbackPredictions, fallbackStatus, false)
                    );
                    return;
                }

                setEditGymLoading(false);
                if (status === placesStatus.ZERO_RESULTS) {
                    setEditGymSuggestions([]);
                    setEditGymError('');
                    return;
                }

                setEditGymSuggestions([]);
                setEditGymError('Could not load gym suggestions. Please try again.');
            };

            autocompleteServiceRef.current.getPlacePredictions(
                {
                    input: queryText,
                    types: ['establishment'],
                    componentRestrictions: { country: countryCodeRef.current }
                },
                (predictions, status) => handleResult(predictions, status, true)
            );
        }, 180);

        return () => clearTimeout(timeoutId);
    }, [editGymQuery, editSelectedGym, placesReady, showEditSessionModal]);

    useEffect(() => {
        return () => {
            if (placesContainerRef.current?.parentNode) {
                placesContainerRef.current.parentNode.removeChild(placesContainerRef.current);
            }
        };
    }, []);

    const resolveGymSuggestion = (suggestion, setLoading, setSelected, setQuery, setSuggestions, setError, setNickname) => {
        if (!suggestion?.placeId || !placesServiceRef.current || !window.google?.maps?.places) {
            setSelected({
                placeId: suggestion?.placeId || '',
                name: suggestion?.primaryText || suggestion?.description || '',
                address: suggestion?.secondaryText || '',
                lat: null,
                lng: null
            });
            setNickname(getRememberedNickname(suggestion?.placeId || ''));
            setQuery(suggestion?.primaryText || suggestion?.description || '');
            setSuggestions([]);
            return;
        }

        setLoading(true);
        placesServiceRef.current.getDetails(
            {
                placeId: suggestion.placeId,
                fields: ['place_id', 'name', 'formatted_address', 'geometry.location']
            },
            (place, status) => {
                setLoading(false);
                const placesStatus = window.google?.maps?.places?.PlacesServiceStatus;
                if (status !== placesStatus?.OK || !place) {
                    setSelected({
                        placeId: suggestion.placeId,
                        name: suggestion.primaryText || suggestion.description,
                        address: suggestion.secondaryText || '',
                        lat: null,
                        lng: null
                    });
                    setNickname(getRememberedNickname(suggestion.placeId));
                    setQuery(suggestion.primaryText || suggestion.description);
                    setSuggestions([]);
                    setError('Gym details were partially unavailable. Name will still be saved.');
                    return;
                }

                const rawLat = place.geometry?.location?.lat?.();
                const rawLng = place.geometry?.location?.lng?.();
                const placeId = place.place_id || suggestion.placeId;
                setSelected({
                    placeId,
                    name: place.name || suggestion.primaryText || suggestion.description,
                    address: place.formatted_address || suggestion.secondaryText || '',
                    lat: Number.isFinite(rawLat) ? rawLat : null,
                    lng: Number.isFinite(rawLng) ? rawLng : null
                });
                setNickname(getRememberedNickname(placeId));
                setQuery(place.name || suggestion.primaryText || suggestion.description);
                setSuggestions([]);
                setError('');
            }
        );
    };

    const handleSelectGymSuggestion = (suggestion) => {
        resolveGymSuggestion(
            suggestion,
            setGymLoading,
            setSelectedGym,
            setGymQuery,
            setGymSuggestions,
            setGymError,
            setGymNickname
        );
    };

    const handleSelectEditGymSuggestion = (suggestion) => {
        resolveGymSuggestion(
            suggestion,
            setEditGymLoading,
            setEditSelectedGym,
            setEditGymQuery,
            setEditGymSuggestions,
            setEditGymError,
            setEditGymNickname
        );
    };

    const runMigration = async () => {
        if (!user || migrationRunning) return;

        setMigrationRunning(true);
        setMigrationError('');

        try {
            const legacyRef = collection(db, 'users', user.uid, 'climbing_history');
            const legacySnap = await getDocs(legacyRef);

            if (legacySnap.empty) {
                await setDoc(
                    doc(db, 'users', user.uid, 'meta', 'climbing_migration'),
                    { version: MIGRATION_VERSION, completedAt: serverTimestamp(), sessionsMigrated: 0, climbsMigrated: 0 },
                    { merge: true }
                );
                setMigrationStats({ sessions: 0, climbs: 0 });
                setMigrationCompleted(true);
                setShowMigrationModal(false);
                setLegacyClimbs([]);
                return;
            }

            const rows = legacySnap.docs.map((snap) => {
                const data = snap.data() || {};
                const timestamp = data.date?.toMillis?.() || Date.now();
                return {
                    id: snap.id,
                    ...data,
                    timestamp,
                    dateKey: data.dateKey || getDateKeyFromTimestamp(timestamp),
                    createdAtMs: data.createdAt?.toMillis?.() || timestamp
                };
            });

            const grouped = new Map();
            rows.forEach((row) => {
                const preferredSessionId = normalizeDocId(row.sessionId);
                const key = preferredSessionId || `${row.dateKey}|${row.type || 'boulder'}|${row.gymPlaceId || row.gymName || 'nogym'}|legacy`;
                if (!grouped.has(key)) {
                    grouped.set(key, {
                        key,
                        preferredSessionId,
                        representative: row,
                        climbs: []
                    });
                }
                grouped.get(key).climbs.push(row);
            });

            const groups = Array.from(grouped.values());
            let migratedSessionCount = 0;
            let migratedClimbCount = 0;

            for (const group of groups) {
                const rep = group.representative;
                const fallbackSessionId = `legacy_session_${hashString(group.key)}`;
                const sessionRef = group.preferredSessionId
                    ? doc(db, 'users', user.uid, 'climbing_sessions', group.preferredSessionId)
                    : doc(db, 'users', user.uid, 'climbing_sessions', fallbackSessionId);

                const [y, m, d] = (rep.dateKey || getDateKeyFromTimestamp(rep.timestamp)).split('-').map(Number);
                const dateObj = y && m && d
                    ? new Date(y, m - 1, d, 12, 0, 0, 0)
                    : new Date(rep.timestamp);
                const dateKey = rep.dateKey || getDateKeyFromTimestamp(rep.timestamp);

                const sessionPayload = {
                    type: rep.type || 'boulder',
                    date: dateObj,
                    dateKey,
                    migratedFromLegacy: true,
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                    ...buildGymPayload(
                        {
                            placeId: rep.gymPlaceId || '',
                            name: rep.gymName || '',
                            address: rep.gymAddress || '',
                            lat: Number.isFinite(rep.gymLat) ? rep.gymLat : null,
                            lng: Number.isFinite(rep.gymLng) ? rep.gymLng : null
                        },
                        rep.gymNickname || ''
                    )
                };

                const sortedClimbs = [...group.climbs].sort((a, b) => {
                    const createdDiff = (a.createdAtMs || a.timestamp) - (b.createdAtMs || b.timestamp);
                    if (createdDiff !== 0) return createdDiff;
                    return a.id.localeCompare(b.id);
                });

                const climbPayloads = sortedClimbs.map((climb, index) => {
                    const payload = {
                        grade: climb.grade ?? null,
                        time: Number.isFinite(Number.parseFloat(climb.time)) ? Number.parseFloat(climb.time) : null,
                        order: index,
                        migratedFromLegacy: true,
                        createdAt: serverTimestamp(),
                        updatedAt: serverTimestamp()
                    };
                    if (typeof climb.remark === 'string' && climb.remark.trim()) {
                        payload.remark = climb.remark.trim();
                    }
                    return {
                        id: `legacy_climb_${hashString(`${group.key}|${climb.id}`)}`,
                        data: payload
                    };
                });

                await commitSessionWithClimbs(sessionRef, sessionPayload, climbPayloads);
                migratedSessionCount += 1;
                migratedClimbCount += climbPayloads.length;
            }

            await setDoc(
                doc(db, 'users', user.uid, 'meta', 'climbing_migration'),
                {
                    version: MIGRATION_VERSION,
                    completedAt: serverTimestamp(),
                    sessionsMigrated: migratedSessionCount,
                    climbsMigrated: migratedClimbCount
                },
                { merge: true }
            );

            setMigrationStats({ sessions: migratedSessionCount, climbs: migratedClimbCount });
            setMigrationCompleted(true);
            setShowMigrationModal(false);
            setLegacyClimbs([]);
        } catch (error) {
            console.error('Migration failed:', error);
            setMigrationError('Migration failed. Please try again.');
        } finally {
            setMigrationRunning(false);
        }
    };

    const cycleClimbType = () => {
        if (climbType === 'boulder') setClimbType('top_rope');
        else if (climbType === 'top_rope') setClimbType('lead');
        else if (climbType === 'lead') setClimbType('speed');
        else setClimbType('boulder');
    };

    const openLogModal = () => {
        if (isLegacyMode) {
            setShowMigrationModal(true);
            return;
        }

        setLogMode('single');
        setSelectedGrade(getDefaultGradeByType(climbType));
        setLogTime('');
        setLogDate(getLocalToday());
        setBulkCounts(createBulkCounts(climbType));
        setLogRouteRemark('');
        setLogSessionNote('');
        resetLogGymState();
        setShowLogModal(true);
    };

    const closeLogModal = () => {
        setShowLogModal(false);
        setLogMode('single');
        setSelectedGrade(getDefaultGradeByType(climbType));
        setLogTime('');
        setLogDate(getLocalToday());
        setBulkCounts(createBulkCounts(climbType));
        setLogRouteRemark('');
        setLogSessionNote('');
        resetLogGymState();
    };

    const updateBulkCount = (grade, rawValue) => {
        if (rawValue === '') {
            setBulkCounts((prev) => ({ ...prev, [grade]: '' }));
            return;
        }
        if (!/^\d+$/.test(rawValue)) return;
        const parsed = Math.max(0, Number.parseInt(rawValue, 10));
        setBulkCounts((prev) => ({ ...prev, [grade]: String(parsed) }));
    };

    const handleLogClimb = async () => {
        if (!user || isLegacyMode) return;

        const [y, m, d] = logDate.split('-').map(Number);
        if (!y || !m || !d) return;

        const dateObj = new Date(y, m - 1, d, 12, 0, 0, 0);
        const dateKey = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

        try {
            const sessionsCollection = collection(db, 'users', user.uid, 'climbing_sessions');
            const sessionRef = doc(sessionsCollection);
            const gymPayload = buildGymPayload(selectedGym, gymNickname);

            if (selectedGym) {
                await rememberGymNickname(selectedGym, gymNickname);
            }

            const sessionPayload = {
                type: climbType,
                date: dateObj,
                dateKey,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                ...gymPayload
            };

            if (logMode === 'session' && climbType !== 'speed') {
                const trimmedSessionNote = logSessionNote.trim();
                if (trimmedSessionNote) {
                    sessionPayload.sessionNote = trimmedSessionNote;
                }

                const entries = [];
                getGradesForType(climbType).forEach((grade) => {
                    const parsed = Number.parseInt(bulkCounts[grade], 10);
                    const count = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
                    for (let i = 0; i < count; i += 1) entries.push(grade);
                });

                if (entries.length === 0) return;

                const climbPayloads = entries.map((grade, index) => ({
                    grade,
                    time: null,
                    order: index,
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp()
                }));

                await commitSessionWithClimbs(sessionRef, sessionPayload, climbPayloads);
            } else {
                const parsedSpeedTime = Number.parseFloat(logTime);
                if (climbType === 'speed' && (!Number.isFinite(parsedSpeedTime) || parsedSpeedTime <= 0)) return;

                const trimmedRouteRemark = logRouteRemark.trim();
                const climbPayload = {
                    grade: climbType === 'speed' ? null : selectedGrade,
                    time: climbType === 'speed' ? parsedSpeedTime : null,
                    order: 0,
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp()
                };
                if (trimmedRouteRemark) climbPayload.remark = trimmedRouteRemark;

                await commitSessionWithClimbs(sessionRef, sessionPayload, [climbPayload]);
            }

            closeLogModal();
        } catch (error) {
            console.error('Error logging climb:', error);
            setGymError('Could not save log. Please try again.');
        }
    };

    const openEditSessionModal = (session) => {
        if (!session || session.legacy) {
            setShowMigrationModal(true);
            return;
        }

        setEditingSession(session);
        setEditSessionDate(session.dateKey || getDateKeyFromTimestamp(session.timestamp));
        setEditSessionNote(typeof session.sessionNote === 'string' ? session.sessionNote : '');

        if (session.gymPlaceId || session.gymName) {
            setEditSelectedGym({
                placeId: session.gymPlaceId || '',
                name: session.gymName || '',
                address: session.gymAddress || '',
                lat: Number.isFinite(session.gymLat) ? session.gymLat : null,
                lng: Number.isFinite(session.gymLng) ? session.gymLng : null
            });
            setEditGymQuery(session.gymName || '');
        } else {
            setEditSelectedGym(null);
            setEditGymQuery('');
        }

        setEditGymNickname(session.gymNickname || getRememberedNickname(session.gymPlaceId || ''));
        setEditGymSuggestions([]);
        setEditGymLoading(false);
        setEditGymError('');
        setShowEditSessionModal(true);
    };

    const closeEditSessionModal = () => {
        setShowEditSessionModal(false);
        setEditingSession(null);
        setEditSessionDate(getLocalToday());
        setEditSessionNote('');
        setIsSavingSession(false);
        resetEditSessionGymState();
    };

    const handleSaveSessionEdit = async () => {
        if (!user || !editingSession || isSavingSession) return;

        const [y, m, d] = editSessionDate.split('-').map(Number);
        if (!y || !m || !d) {
            setEditGymError('Please provide a valid date.');
            return;
        }

        const dateObj = new Date(y, m - 1, d, 12, 0, 0, 0);
        const dateKey = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

        const payload = {
            date: dateObj,
            dateKey,
            updatedAt: serverTimestamp()
        };

        const trimmedSessionNote = editSessionNote.trim();
        if (trimmedSessionNote) {
            payload.sessionNote = trimmedSessionNote;
        } else {
            payload.sessionNote = deleteField();
        }

        if (editSelectedGym) {
            Object.assign(payload, buildGymPayload(editSelectedGym, editGymNickname));
            await rememberGymNickname(editSelectedGym, editGymNickname);
        } else {
            payload.gymPlaceId = deleteField();
            payload.gymName = deleteField();
            payload.gymAddress = deleteField();
            payload.gymLat = deleteField();
            payload.gymLng = deleteField();
            payload.gymSource = deleteField();
            payload.gymNickname = deleteField();
        }

        setIsSavingSession(true);
        setEditGymError('');

        try {
            await updateDoc(doc(db, 'users', user.uid, 'climbing_sessions', editingSession.id), payload);
            closeEditSessionModal();
        } catch (error) {
            console.error('Session edit failed:', error);
            setEditGymError('Could not save session changes. Please try again.');
        } finally {
            setIsSavingSession(false);
        }
    };

    const openEditClimbModal = (sessionId, sessionType, climb) => {
        if (!sessionId || !climb || climb.legacy) {
            setShowMigrationModal(true);
            return;
        }

        const nextClimbType = sessionType || climbType;
        setEditingClimb(climb);
        setEditingClimbSessionId(sessionId);
        setEditingClimbType(nextClimbType);
        setEditClimbGrade(climb.grade || getDefaultGradeByType(nextClimbType));
        setEditClimbTime(
            climb.time === null || climb.time === undefined || climb.time === ''
                ? ''
                : String(climb.time)
        );
        setEditClimbRemark(typeof climb.remark === 'string' ? climb.remark : '');
        setEditClimbError('');
        setIsSavingClimb(false);
        setShowEditClimbModal(true);
    };

    const closeEditClimbModal = () => {
        setShowEditClimbModal(false);
        setEditingClimb(null);
        setEditingClimbSessionId('');
        setEditingClimbType('boulder');
        setEditClimbGrade(getDefaultGradeByType(climbType));
        setEditClimbTime('');
        setEditClimbRemark('');
        setEditClimbError('');
        setIsSavingClimb(false);
    };

    const handleSaveClimbEdit = async () => {
        if (!user || !editingClimb || !editingClimbSessionId || isSavingClimb) return;

        const payload = { updatedAt: serverTimestamp() };

        if (editingClimbType === 'speed') {
            const parsed = Number.parseFloat(editClimbTime);
            if (!Number.isFinite(parsed) || parsed <= 0) {
                setEditClimbError('Please enter a valid speed time.');
                return;
            }
            payload.time = parsed;
            payload.grade = null;
        } else {
            if (!editClimbGrade) {
                setEditClimbError('Please choose a grade.');
                return;
            }
            payload.grade = editClimbGrade;
            payload.time = null;
        }

        const trimmedRemark = editClimbRemark.trim();
        if (trimmedRemark) {
            payload.remark = trimmedRemark;
        } else {
            payload.remark = deleteField();
        }

        setIsSavingClimb(true);
        setEditClimbError('');

        try {
            await updateDoc(doc(db, 'users', user.uid, 'climbing_sessions', editingClimbSessionId, 'climbs', editingClimb.id), payload);
            closeEditClimbModal();
        } catch (error) {
            console.error('Climb edit failed:', error);
            setEditClimbError('Could not save climb changes. Please try again.');
        } finally {
            setIsSavingClimb(false);
        }
    };

    const handleDeleteClimb = async (sessionId, climbId, isLegacy) => {
        if (isLegacy || !user || !sessionId || !climbId) {
            setShowMigrationModal(true);
            return;
        }
        if (!window.confirm('Delete this climb?')) return;
        try {
            await deleteDoc(doc(db, 'users', user.uid, 'climbing_sessions', sessionId, 'climbs', climbId));
        } catch (error) {
            console.error('Delete climb failed:', error);
        }
    };

    const handleDeleteSession = async (session) => {
        if (!user || !session || session.legacy) {
            setShowMigrationModal(true);
            return;
        }
        if (!window.confirm('Delete this session and all climbs in it?')) return;

        try {
            const climbs = climbsBySession[session.id] || [];
            for (let start = 0; start < climbs.length; start += BATCH_CHUNK_SIZE) {
                const batch = writeBatch(db);
                const chunk = climbs.slice(start, start + BATCH_CHUNK_SIZE);
                chunk.forEach((climb) => {
                    batch.delete(doc(db, 'users', user.uid, 'climbing_sessions', session.id, 'climbs', climb.id));
                });
                await batch.commit();
            }
            await deleteDoc(doc(db, 'users', user.uid, 'climbing_sessions', session.id));
        } catch (error) {
            console.error('Delete session failed:', error);
        }
    };

    const closeHistoryModal = () => {
        setShowHistoryModal(false);
        closeEditSessionModal();
        closeEditClimbModal();
    };

    const parsedSpeedTime = Number.parseFloat(logTime);
    const canSaveSingle = climbType === 'speed'
        ? Number.isFinite(parsedSpeedTime) && parsedSpeedTime > 0
        : Boolean(selectedGrade);
    const canSaveLog = logMode === 'session' && climbType !== 'speed'
        ? totalBulkClimbs > 0
        : canSaveSingle;

    const editClimbType = editingClimbType || climbType;
    const parsedEditClimbTime = Number.parseFloat(editClimbTime);
    const canSaveClimbEdit = editClimbType === 'speed'
        ? Number.isFinite(parsedEditClimbTime) && parsedEditClimbTime > 0
        : Boolean(editClimbGrade);

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
                        {climbType === 'boulder' ? 'Bouldering' : climbType === 'top_rope' ? 'Top Rope' : climbType === 'lead' ? 'Lead' : 'Speed'}
                    </button>
                </div>

                <div className="climb-top-actions">
                    {isLegacyMode && (
                        <button
                            className="climb-migrate-btn-top"
                            onClick={() => setShowMigrationModal(true)}
                        >
                            Migrate Data
                        </button>
                    )}
                    <button
                        className="climb-history-btn-top"
                        onClick={() => setShowHistoryModal(true)}
                    >
                        Show History
                    </button>
                </div>
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
                                stroke="#f59e0b"
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
                                ticks={timeRange === 'ALL'
                                    ? (climbType === 'boulder'
                                        ? ['VB', 'V1', 'V3', 'V5', 'V7', 'V9', 'V11', 'V13', 'V15', 'V17']
                                        : ['5.6', '5.8', '5.10a', '5.11a', '5.12a', '5.13a', '5.14a', '5.15a', '5.15d'])
                                    : undefined}
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
                                    <Cell key={`cell-${index}`} fill={getBarColorByType(climbType, entry.grade)} />
                                ))}
                            </Bar>
                        </BarChart>
                    )}
                </ResponsiveContainer>
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.5rem' }}>
                <div className="time-range-controls">
                    {['1W', '1M', '1Y', 'ALL'].map((range) => (
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

            {showLogModal && createPortal(
                <div className="climb-modal-overlay" onClick={closeLogModal}>
                    <div className="climb-modal climb-log-modal" onClick={(e) => e.stopPropagation()}>
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
                                <p className="climb-log-mode-note">Session bulk logging is not available for Speed yet.</p>
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
                                                setGymNickname('');
                                            }
                                        }}
                                        placeholder={placesReady ? 'Search climbing gym...' : 'Gym search unavailable (optional)'}
                                        className="climb-date-input gym-search-input"
                                        autoComplete="off"
                                    />
                                    {selectedGym && (
                                        <button
                                            type="button"
                                            className="gym-clear-btn"
                                            onClick={() => {
                                                setSelectedGym(null);
                                                setGymQuery('');
                                                setGymNickname('');
                                                setGymSuggestions([]);
                                                setGymError('');
                                            }}
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
                                                {suggestion.secondaryText && <span className="gym-suggestion-secondary">{suggestion.secondaryText}</span>}
                                            </button>
                                        ))}
                                    </div>
                                )}

                                {selectedGym && (
                                    <div className="selected-gym-chip">
                                        <span className="selected-gym-name">{selectedGym.name}</span>
                                        {selectedGym.address && <span className="selected-gym-address">{selectedGym.address}</span>}
                                    </div>
                                )}

                                {selectedGym && (
                                    <div className="form-group gym-nickname-group">
                                        <input
                                            type="text"
                                            value={gymNickname}
                                            onChange={(e) => setGymNickname(e.target.value)}
                                            className="climb-date-input"
                                            placeholder="Nickname (optional), e.g. CRG Fenway"
                                            maxLength={64}
                                        />
                                    </div>
                                )}

                                {placesLoading && !gymLoading && <div className="gym-helper-text">Loading gym search...</div>}
                                {gymError && <div className="gym-helper-text error">{gymError}</div>}
                            </div>

                            {(logMode === 'single' || climbType === 'speed') ? (
                                <>
                                    <div className="form-group">
                                        <label>{climbType === 'speed' ? 'Time (seconds)' : 'Grade'}</label>
                                        {climbType === 'speed' ? (
                                            <input
                                                type="number"
                                                placeholder="e.g. 15.4"
                                                value={logTime}
                                                onChange={(e) => setLogTime(e.target.value)}
                                                className="climb-date-input"
                                                step="0.01"
                                                min="0"
                                                autoFocus
                                            />
                                        ) : (
                                            <div className="grade-grid">
                                                {getGradesForType(climbType).map((g) => (
                                                    <button
                                                        key={g}
                                                        className={`grade-select-btn ${selectedGrade === g ? 'selected' : ''}`}
                                                        onClick={() => setSelectedGrade(g)}
                                                        style={{
                                                            borderColor: selectedGrade === g ? getBarColorByType(climbType, g) : 'transparent',
                                                            backgroundColor: selectedGrade === g ? `${getBarColorByType(climbType, g)}20` : '#f5f5f5',
                                                            color: selectedGrade === g ? getBarColorByType(climbType, g) : '#333'
                                                        }}
                                                    >
                                                        {g}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                    <div className="form-group climb-remark-group">
                                        <input
                                            type="text"
                                            value={logRouteRemark}
                                            onChange={(e) => setLogRouteRemark(e.target.value)}
                                            className="climb-date-input"
                                            placeholder="Route remark (optional), e.g. New beta / route name"
                                            maxLength={ROUTE_REMARK_MAX}
                                        />
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div className="form-group climb-remark-group">
                                        <input
                                            type="text"
                                            value={logSessionNote}
                                            onChange={(e) => setLogSessionNote(e.target.value)}
                                            className="climb-date-input"
                                            placeholder="Session note (optional), e.g. Not feeling great"
                                            maxLength={SESSION_NOTE_MAX}
                                        />
                                    </div>

                                    <div className="form-group session-form-group">
                                        <div className="session-grade-grid-scroll">
                                            <div className="session-grade-grid">
                                                {getGradesForType(climbType).map((grade) => (
                                                    <label
                                                        className="session-grade-row"
                                                        key={grade}
                                                        style={{
                                                            borderColor: `${getBarColorByType(climbType, grade)}33`,
                                                            backgroundColor: `${getBarColorByType(climbType, grade)}10`
                                                        }}
                                                    >
                                                        <span
                                                            className="session-grade-label"
                                                            style={{
                                                                color: getBarColorByType(climbType, grade),
                                                                backgroundColor: `${getBarColorByType(climbType, grade)}1a`
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
                                </>
                            )}
                        </div>

                        <div className="modal-actions">
                            <button className="cancel-btn" onClick={closeLogModal}>Cancel</button>
                            <button className="save-btn" onClick={handleLogClimb} disabled={!canSaveLog}>
                                {logMode === 'session' && climbType !== 'speed' ? 'Save Session' : 'Log It!'}
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {showHistoryModal && createPortal(
                <div className="climb-modal-overlay" onClick={closeHistoryModal}>
                    <div className="climb-modal history-modal-content" onClick={(e) => e.stopPropagation()}>
                        <div className="history-header">
                            <h3>Climb History</h3>
                            <button className="close-icon" onClick={closeHistoryModal}>✕</button>
                        </div>

                        {isLegacyMode && (
                            <div className="migration-inline-warning">
                                Data migration is required for session editing and nested route management.
                                <button onClick={() => setShowMigrationModal(true)}>Migrate now</button>
                            </div>
                        )}

                        <div className="history-list">
                            {historySessions.length === 0 ? (
                                <p className="empty-message">No climbs logged yet. Go send some rocks!</p>
                            ) : (
                                historySessions.map((session) => (
                                    <div key={session.id} className="history-session-card">
                                        <div className="history-session-header">
                                            <div className="history-session-header-left">
                                                <div className="history-session-title">
                                                    {formatDateKeyAsUs(session.dateKey || getDateKeyFromTimestamp(session.timestamp))}
                                                    <span className="history-session-gym">{getGymLabel(session)}</span>
                                                </div>
                                                {typeof session.sessionNote === 'string' && session.sessionNote.trim() && (
                                                    <div className="history-session-note" title={session.sessionNote.trim()}>{session.sessionNote.trim()}</div>
                                                )}
                                            </div>
                                            <div className="history-session-actions">
                                                <button
                                                    className="edit-log-btn"
                                                    onClick={() => openEditSessionModal(session)}
                                                    disabled={session.legacy}
                                                >
                                                    Edit Session
                                                </button>
                                                <button
                                                    className="delete-log-btn"
                                                    onClick={() => handleDeleteSession(session)}
                                                    disabled={session.legacy}
                                                >
                                                    Delete Session
                                                </button>
                                            </div>
                                        </div>

                                        <div className="history-session-climbs">
                                            {session.climbs.length === 0 ? (
                                                <div className="history-empty-session">No climbs in this session.</div>
                                            ) : (
                                                session.climbs.map((climb) => (
                                                    <div key={climb.id} className="history-session-climb-row">
                                                        <div className="history-session-climb-main">
                                                            {(() => {
                                                                const badgeColor = climbType === 'speed'
                                                                    ? '#f59e0b'
                                                                    : (typeof climb.grade === 'string' ? getBarColorByType(climbType, climb.grade) : '#94a3b8');
                                                                const speedTime = Number.parseFloat(climb.time);
                                                                const badgeLabel = climbType === 'speed'
                                                                    ? (Number.isFinite(speedTime) ? `${speedTime}s` : '-')
                                                                    : (climb.grade || '-');
                                                                return (
                                                                    <span className="history-grade" style={{ backgroundColor: badgeColor }}>
                                                                        {badgeLabel}
                                                                    </span>
                                                                );
                                                            })()}
                                                            <span className={`history-route-remark ${climb.remark ? '' : 'empty'}`} title={climb.remark || ''}>
                                                                {climb.remark ? climb.remark : 'No route remark'}
                                                            </span>
                                                        </div>
                                                        <div className="history-item-actions">
                                                            <button
                                                                className="edit-log-btn"
                                                                onClick={() => openEditClimbModal(session.id, session.type, climb)}
                                                                disabled={climb.legacy}
                                                            >
                                                                Edit
                                                            </button>
                                                            <button
                                                                className="delete-log-btn"
                                                                onClick={() => handleDeleteClimb(session.id, climb.id, climb.legacy)}
                                                                disabled={climb.legacy}
                                                            >
                                                                Delete
                                                            </button>
                                                        </div>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {showEditSessionModal && createPortal(
                <div className="climb-modal-overlay" onClick={closeEditSessionModal}>
                    <div className="climb-modal edit-session-modal" onClick={(e) => e.stopPropagation()}>
                        <h3>Edit Session</h3>
                        <div className="edit-session-modal-content">
                            <div className="form-group">
                                <label>Date</label>
                                <input
                                    type="date"
                                    value={editSessionDate}
                                    onChange={(e) => setEditSessionDate(e.target.value)}
                                    className="climb-date-input"
                                />
                            </div>

                            <div className="form-group climb-remark-group">
                                <input
                                    type="text"
                                    value={editSessionNote}
                                    onChange={(e) => setEditSessionNote(e.target.value)}
                                    className="climb-date-input"
                                    placeholder="Session note (optional), e.g. Not feeling great"
                                    maxLength={SESSION_NOTE_MAX}
                                />
                            </div>

                            <div className="form-group">
                                <label>Gym (optional)</label>
                                <div className="gym-search-field">
                                    <input
                                        type="text"
                                        value={editGymQuery}
                                        onChange={(e) => {
                                            const nextValue = e.target.value;
                                            setEditGymQuery(nextValue);
                                            setEditGymError('');
                                            if (editSelectedGym && nextValue !== editSelectedGym.name) {
                                                setEditSelectedGym(null);
                                                setEditGymNickname('');
                                            }
                                        }}
                                        placeholder={placesReady ? 'Search climbing gym...' : 'Gym search unavailable (optional)'}
                                        className="climb-date-input gym-search-input"
                                        autoComplete="off"
                                    />
                                    {editSelectedGym && (
                                        <button
                                            type="button"
                                            className="gym-clear-btn"
                                            onClick={() => {
                                                setEditSelectedGym(null);
                                                setEditGymQuery('');
                                                setEditGymNickname('');
                                                setEditGymSuggestions([]);
                                                setEditGymError('');
                                            }}
                                        >
                                            Clear
                                        </button>
                                    )}
                                </div>

                                {editGymLoading && <div className="gym-helper-text">Searching gyms...</div>}

                                {placesReady && editGymSuggestions.length > 0 && (
                                    <div className="gym-suggestions" role="listbox">
                                        {editGymSuggestions.map((suggestion) => (
                                            <button
                                                type="button"
                                                key={suggestion.placeId}
                                                className="gym-suggestion-btn"
                                                onClick={() => handleSelectEditGymSuggestion(suggestion)}
                                            >
                                                <span className="gym-suggestion-primary">{suggestion.primaryText}</span>
                                                {suggestion.secondaryText && <span className="gym-suggestion-secondary">{suggestion.secondaryText}</span>}
                                            </button>
                                        ))}
                                    </div>
                                )}

                                {editSelectedGym && (
                                    <div className="selected-gym-chip">
                                        <span className="selected-gym-name">{editSelectedGym.name}</span>
                                        {editSelectedGym.address && <span className="selected-gym-address">{editSelectedGym.address}</span>}
                                    </div>
                                )}

                                {editSelectedGym && (
                                    <div className="form-group gym-nickname-group">
                                        <input
                                            type="text"
                                            value={editGymNickname}
                                            onChange={(e) => setEditGymNickname(e.target.value)}
                                            className="climb-date-input"
                                            placeholder="Nickname (optional), e.g. CRG Fenway"
                                            maxLength={64}
                                        />
                                    </div>
                                )}

                                {placesLoading && !editGymLoading && <div className="gym-helper-text">Loading gym search...</div>}
                                {editGymError && <div className="gym-helper-text error">{editGymError}</div>}
                            </div>
                        </div>

                        <div className="modal-actions">
                            <button className="cancel-btn" onClick={closeEditSessionModal}>Cancel</button>
                            <button className="save-btn" onClick={handleSaveSessionEdit} disabled={isSavingSession || !editSessionDate}>
                                {isSavingSession ? 'Saving…' : 'Save Session'}
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {showEditClimbModal && createPortal(
                <div className="climb-modal-overlay" onClick={closeEditClimbModal}>
                    <div className="climb-modal edit-climb-modal" onClick={(e) => e.stopPropagation()}>
                        <h3>Edit Climb</h3>
                        <div className="edit-climb-modal-content">
                            <div className="form-group">
                                <label>{editClimbType === 'speed' ? 'Time (seconds)' : 'Grade'}</label>
                                {editClimbType === 'speed' ? (
                                    <input
                                        type="number"
                                        placeholder="e.g. 15.4"
                                        value={editClimbTime}
                                        onChange={(e) => setEditClimbTime(e.target.value)}
                                        className="climb-date-input"
                                        step="0.01"
                                        min="0"
                                    />
                                ) : (
                                    <div className="grade-grid">
                                        {getGradesForType(editClimbType).map((g) => (
                                            <button
                                                key={g}
                                                className={`grade-select-btn ${editClimbGrade === g ? 'selected' : ''}`}
                                                onClick={() => setEditClimbGrade(g)}
                                                style={{
                                                    borderColor: editClimbGrade === g ? getBarColorByType(editClimbType, g) : 'transparent',
                                                    backgroundColor: editClimbGrade === g ? `${getBarColorByType(editClimbType, g)}20` : '#f5f5f5',
                                                    color: editClimbGrade === g ? getBarColorByType(editClimbType, g) : '#333'
                                                }}
                                            >
                                                {g}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className="form-group climb-remark-group">
                                <input
                                    type="text"
                                    value={editClimbRemark}
                                    onChange={(e) => setEditClimbRemark(e.target.value)}
                                    className="climb-date-input"
                                    placeholder="Route remark (optional), e.g. New beta / route name"
                                    maxLength={ROUTE_REMARK_MAX}
                                />
                            </div>

                            {editClimbError && <div className="gym-helper-text error">{editClimbError}</div>}
                        </div>

                        <div className="modal-actions">
                            <button className="cancel-btn" onClick={closeEditClimbModal}>Cancel</button>
                            <button className="save-btn" onClick={handleSaveClimbEdit} disabled={!canSaveClimbEdit || isSavingClimb}>
                                {isSavingClimb ? 'Saving…' : 'Save Climb'}
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {showMigrationModal && createPortal(
                <div className="climb-modal-overlay" onClick={() => { if (!migrationRunning) setShowMigrationModal(false); }}>
                    <div className="climb-modal migration-modal" onClick={(e) => e.stopPropagation()}>
                        <h3>Migrate Climbing Data</h3>
                        <p className="migration-copy">
                            Move legacy climb logs into session-based storage so each session stores shared date/gym/note and each route stays nested under it.
                        </p>
                        {migrationStats.sessions > 0 && (
                            <p className="migration-copy success">
                                Last migration moved {migrationStats.climbs} climbs into {migrationStats.sessions} sessions.
                            </p>
                        )}
                        {migrationError && <p className="migration-copy error">{migrationError}</p>}
                        <div className="modal-actions">
                            <button
                                className="cancel-btn"
                                onClick={() => setShowMigrationModal(false)}
                                disabled={migrationRunning}
                            >
                                Cancel
                            </button>
                            <button className="save-btn" onClick={runMigration} disabled={migrationRunning}>
                                {migrationRunning ? 'Migrating…' : 'Migrate Now'}
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
};

export default ClimbingTracker;
