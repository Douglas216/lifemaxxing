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
import {
    isCoupleAccountByUid,
    getPartnerUid,
    getDisplayNameForUid
} from '../constants';
import blankUsMap from '../assets/Blank_US_Map_(states_only).svg';
import ydsUsMap from '../assets/YDS_US_Map_Yosemite.svg';
import speedWallStandard from '../assets/Speed_Wall_Standard.svg';
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
const SOLO_CHART_MODE = 'solo';
const COMPARE_CHART_MODE = 'compare';
const DOUGLAS_COMPARE_BAR_COLOR = '#1d4ed8';
const NANCY_COMPARE_BAR_COLOR = '#ec4899';

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

const supportsDisciplineTooltip = (type) => type === 'boulder' || type === 'top_rope' || type === 'lead' || type === 'speed';

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

const getGymLocationSnippet = (session) => {
    const nickname = typeof session.gymNickname === 'string' ? session.gymNickname.trim() : '';
    const name = typeof session.gymName === 'string' ? session.gymName.trim() : '';
    const address = typeof session.gymAddress === 'string' ? session.gymAddress.trim() : '';
    const city = getGymCityFromAddress(address);

    if (nickname) {
        if (name && city) return `${name}, ${city}`;
        return name || city || address;
    }

    return address || city;
};

const normalizeGymGroupPart = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');

const getSessionGymGroupKey = (session) => {
    const placeId = typeof session?.gymPlaceId === 'string' ? session.gymPlaceId.trim() : '';
    if (placeId) return `place:${placeId}`;

    const name = normalizeGymGroupPart(session?.gymName);
    const address = normalizeGymGroupPart(session?.gymAddress);
    if (!name && !address) return '';

    return `fallback:${name}|${address}`;
};

const getClimbType = (climb, session) => {
    if (typeof climb?.type === 'string' && climb.type.trim()) return climb.type.trim();
    if (typeof session?.type === 'string' && session.type.trim()) return session.type.trim();
    return 'boulder';
};

const getVisitGroupKey = (session) => {
    const dateKey = session?.dateKey || getDateKeyFromTimestamp(session?.timestamp);
    const gymKey = getSessionGymGroupKey(session);
    if (gymKey) return `${dateKey}|${gymKey}`;
    return `${dateKey}|session:${session?.id || hashString(JSON.stringify(session || {}))}`;
};

const getDisciplineLabel = (type) => {
    if (type === 'top_rope') return 'Top Rope';
    if (type === 'lead') return 'Lead';
    if (type === 'speed') return 'Speed';
    return 'Bouldering';
};

const DISCIPLINE_ORDER = ['boulder', 'top_rope', 'lead', 'speed'];

const buildSavedGymSuggestion = (gym) => {
    const nickname = typeof gym?.nickname === 'string' ? gym.nickname.trim() : '';
    const name = typeof gym?.gymName === 'string' ? gym.gymName.trim() : '';
    const address = typeof gym?.gymAddress === 'string' ? gym.gymAddress.trim() : '';

    return {
        placeId: gym?.placeId || '',
        description: nickname ? `${nickname}${name ? ` - ${name}` : ''}` : name,
        primaryText: nickname || name || 'Saved gym',
        secondaryText: nickname ? (name || address) : address,
        isSavedGym: true,
        savedGym: {
            placeId: gym?.placeId || '',
            name,
            address,
            lat: Number.isFinite(gym?.lat) ? gym.lat : null,
            lng: Number.isFinite(gym?.lng) ? gym.lng : null
        }
    };
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
            type,
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

const buildActiveSessions = (migrationCompleted, sessionsBase, climbsBySession, legacyClimbs) => {
    if (migrationCompleted) {
        return sessionsBase.map((session) => ({
            ...session,
            legacy: false,
            climbs: climbsBySession[session.id] || []
        }));
    }
    return buildLegacySessionCards(legacyClimbs);
};

const buildActiveVisits = (sessions) => {
    const grouped = new Map();

    sessions.forEach((session) => {
        const visitKey = getVisitGroupKey(session);
        const sessionTimestamp = Number.isFinite(session.timestamp) ? session.timestamp : Date.now();
        const sessionNotes = typeof session.sessionNote === 'string' ? session.sessionNote.trim() : '';

        if (!grouped.has(visitKey)) {
            grouped.set(visitKey, {
                id: visitKey,
                dateKey: session.dateKey || getDateKeyFromTimestamp(sessionTimestamp),
                timestamp: sessionTimestamp,
                gymPlaceId: session.gymPlaceId || '',
                gymName: session.gymName || '',
                gymAddress: session.gymAddress || '',
                gymLat: Number.isFinite(session.gymLat) ? session.gymLat : null,
                gymLng: Number.isFinite(session.gymLng) ? session.gymLng : null,
                gymNickname: session.gymNickname || '',
                sessionNote: '',
                legacy: Boolean(session.legacy),
                sourceSessionIds: [],
                disciplines: new Set(),
                sessionNotes: new Set(),
                climbs: []
            });
        }

        const visit = grouped.get(visitKey);
        visit.timestamp = Math.max(visit.timestamp, sessionTimestamp);
        visit.legacy = visit.legacy || Boolean(session.legacy);
        visit.sourceSessionIds.push(session.id);

        if (!visit.gymPlaceId && session.gymPlaceId) visit.gymPlaceId = session.gymPlaceId;
        if (!visit.gymName && session.gymName) visit.gymName = session.gymName;
        if (!visit.gymAddress && session.gymAddress) visit.gymAddress = session.gymAddress;
        if (!Number.isFinite(visit.gymLat) && Number.isFinite(session.gymLat)) visit.gymLat = session.gymLat;
        if (!Number.isFinite(visit.gymLng) && Number.isFinite(session.gymLng)) visit.gymLng = session.gymLng;

        const nextNickname = typeof session.gymNickname === 'string' ? session.gymNickname.trim() : '';
        if (nextNickname && !visit.gymNickname) {
            visit.gymNickname = nextNickname;
        }

        if (sessionNotes) {
            visit.sessionNotes.add(sessionNotes);
        }

        (session.climbs || []).forEach((climb) => {
            const climbTypeValue = getClimbType(climb, session);
            visit.disciplines.add(climbTypeValue);
            visit.climbs.push({
                ...climb,
                type: climbTypeValue,
                sessionId: session.id,
                legacy: Boolean(climb.legacy || session.legacy),
                sessionTimestamp
            });
        });
    });

    return Array.from(grouped.values())
        .map((visit) => {
            const sortedClimbs = [...visit.climbs].sort((a, b) => {
                const orderDiff = (a.order ?? 0) - (b.order ?? 0);
                if (orderDiff !== 0) return orderDiff;
                const timeDiff = (a.sessionTimestamp || 0) - (b.sessionTimestamp || 0);
                if (timeDiff !== 0) return timeDiff;
                return String(a.id).localeCompare(String(b.id));
            });
            const notes = Array.from(visit.sessionNotes);
            return {
                ...visit,
                type: sortedClimbs[0]?.type || 'boulder',
                disciplines: DISCIPLINE_ORDER.filter((type) => visit.disciplines.has(type)),
                sessionNote: notes.join(' • '),
                climbs: sortedClimbs
            };
        })
        .sort((a, b) => b.timestamp - a.timestamp);
};

const getTimeRangeCutoff = (timeRange) => {
    const now = Date.now();
    if (timeRange === '1W') return now - 7 * 24 * 60 * 60 * 1000;
    if (timeRange === '1M') return now - 30 * 24 * 60 * 60 * 1000;
    if (timeRange === '1Y') return now - 365 * 24 * 60 * 60 * 1000;
    return 0;
};

const filterVisitsByTimeRange = (visits, timeRange) => {
    const cutoff = getTimeRangeCutoff(timeRange);
    return visits.filter((visit) => visit.timestamp >= cutoff);
};

const buildSoloChartData = (disciplineHistoryVisits, timeRange, climbType) => {
    const filteredVisits = filterVisitsByTimeRange(disciplineHistoryVisits, timeRange);

    if (climbType === 'speed') {
        const points = [];
        filteredVisits
            .sort((a, b) => a.timestamp - b.timestamp)
            .forEach((visit) => {
                visit.climbs
                    .filter((climb) => climb.type === 'speed')
                    .forEach((climb, index) => {
                        const time = Number.parseFloat(climb.time);
                        if (!Number.isFinite(time) || time <= 0) return;
                        points.push({
                            id: `${visit.id}_${climb.sessionId}_${climb.id}`,
                            timestamp: visit.timestamp + index,
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

    filteredVisits.forEach((visit) => {
        visit.climbs.forEach((climb) => {
            if (climb.type !== climbType) return;
            if (typeof climb.grade === 'string' && counts[climb.grade] !== undefined) {
                counts[climb.grade] += 1;
            }
        });
    });

    return grades
        .map((grade) => ({ grade, count: counts[grade] || 0 }))
        .filter((item) => item.count > 0 || timeRange === 'ALL');
};

const buildPairedBoulderChartData = (viewerVisits, partnerVisits, timeRange) => {
    const filteredViewerVisits = filterVisitsByTimeRange(viewerVisits, timeRange);
    const filteredPartnerVisits = filterVisitsByTimeRange(partnerVisits, timeRange);
    const viewerCounts = V_GRADES.reduce((acc, grade) => ({ ...acc, [grade]: 0 }), {});
    const partnerCounts = V_GRADES.reduce((acc, grade) => ({ ...acc, [grade]: 0 }), {});

    filteredViewerVisits.forEach((visit) => {
        visit.climbs.forEach((climb) => {
            if (climb.type !== 'boulder') return;
            if (typeof climb.grade === 'string' && viewerCounts[climb.grade] !== undefined) {
                viewerCounts[climb.grade] += 1;
            }
        });
    });

    filteredPartnerVisits.forEach((visit) => {
        visit.climbs.forEach((climb) => {
            if (climb.type !== 'boulder') return;
            if (typeof climb.grade === 'string' && partnerCounts[climb.grade] !== undefined) {
                partnerCounts[climb.grade] += 1;
            }
        });
    });

    let visibleGrades;
    if (timeRange === 'ALL') {
        const activeIndices = V_GRADES
            .map((grade, index) => (viewerCounts[grade] > 0 || partnerCounts[grade] > 0 ? index : -1))
            .filter((index) => index >= 0);

        if (activeIndices.length === 0) {
            return [];
        }

        visibleGrades = V_GRADES.slice(activeIndices[0], activeIndices[activeIndices.length - 1] + 1);
    } else {
        visibleGrades = V_GRADES.filter((grade) => viewerCounts[grade] > 0 || partnerCounts[grade] > 0);
    }

    return visibleGrades.map((grade) => ({
        grade,
        viewerCount: viewerCounts[grade] || 0,
        partnerCount: partnerCounts[grade] || 0
    }));
};

const getColorForClimber = (name) => (name === 'Nancy' ? NANCY_COMPARE_BAR_COLOR : DOUGLAS_COMPARE_BAR_COLOR);

const useReadOnlyClimbingVisits = (ownerUid, enabled = true) => {
    const [isMigrationChecked, setIsMigrationChecked] = useState(false);
    const [migrationCompleted, setMigrationCompleted] = useState(false);
    const [sessionsBase, setSessionsBase] = useState([]);
    const [climbsBySession, setClimbsBySession] = useState({});
    const [legacyClimbs, setLegacyClimbs] = useState([]);
    const [loading, setLoading] = useState(Boolean(enabled && ownerUid));
    const [error, setError] = useState('');

    useEffect(() => {
        if (!enabled || !ownerUid) {
            setIsMigrationChecked(false);
            setMigrationCompleted(false);
            setSessionsBase([]);
            setClimbsBySession({});
            setLegacyClimbs([]);
            setLoading(false);
            setError('');
            return undefined;
        }

        let isActive = true;
        setLoading(true);
        setError('');
        setIsMigrationChecked(false);
        setMigrationCompleted(false);
        setSessionsBase([]);
        setClimbsBySession({});
        setLegacyClimbs([]);

        const runCheck = async () => {
            try {
                const markerRef = doc(db, 'users', ownerUid, 'meta', 'climbing_migration');
                const markerSnap = await getDoc(markerRef);
                if (!isActive) return;

                if (markerSnap.exists() && markerSnap.data()?.version === MIGRATION_VERSION) {
                    setMigrationCompleted(true);
                    setIsMigrationChecked(true);
                    return;
                }

                const legacyRef = collection(db, 'users', ownerUid, 'climbing_history');
                const legacySnap = await getDocs(legacyRef);
                if (!isActive) return;

                setMigrationCompleted(legacySnap.empty);
                setIsMigrationChecked(true);
            } catch (readError) {
                if (!isActive) return;
                console.error('Comparison history check failed:', readError);
                setError('Could not load partner climbing history.');
                setLoading(false);
            }
        };

        runCheck();

        return () => {
            isActive = false;
        };
    }, [enabled, ownerUid]);

    useEffect(() => {
        if (!enabled || !ownerUid || !isMigrationChecked || migrationCompleted) return undefined;

        const legacyRef = collection(db, 'users', ownerUid, 'climbing_history');
        return onSnapshot(
            legacyRef,
            (snapshot) => {
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
                setError('');
                setLoading(false);
            },
            (snapshotError) => {
                console.error('Comparison legacy history subscribe failed:', snapshotError);
                setError('Could not load partner climbing history.');
                setLoading(false);
            }
        );
    }, [enabled, ownerUid, isMigrationChecked, migrationCompleted]);

    useEffect(() => {
        if (!enabled || !ownerUid || !isMigrationChecked || !migrationCompleted) return undefined;

        const sessionsRef = collection(db, 'users', ownerUid, 'climbing_sessions');
        const sessionsQuery = query(sessionsRef, orderBy('date', 'desc'));
        return onSnapshot(
            sessionsQuery,
            (snapshot) => {
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
                if (next.length === 0) {
                    setClimbsBySession({});
                    setLoading(false);
                }
                setError('');
            },
            (snapshotError) => {
                console.error('Comparison sessions subscribe failed:', snapshotError);
                setError('Could not load partner climbing history.');
                setLoading(false);
            }
        );
    }, [enabled, ownerUid, isMigrationChecked, migrationCompleted]);

    useEffect(() => {
        if (!enabled || !ownerUid || !migrationCompleted) return undefined;

        if (sessionsBase.length === 0) {
            setClimbsBySession({});
            setLoading(false);
            return undefined;
        }

        const unsubs = sessionsBase.map((session) => {
            const climbsRef = collection(db, 'users', ownerUid, 'climbing_sessions', session.id, 'climbs');
            const climbsQuery = query(climbsRef, orderBy('order', 'asc'));
            return onSnapshot(
                climbsQuery,
                (snapshot) => {
                    const climbs = snapshot.docs.map((snap, index) => {
                        const data = snap.data() || {};
                        return {
                            id: snap.id,
                            ...data,
                            order: Number.isFinite(data.order) ? data.order : index
                        };
                    });
                    setClimbsBySession((prev) => ({ ...prev, [session.id]: climbs }));
                    setError('');
                    setLoading(false);
                },
                (snapshotError) => {
                    console.error('Comparison climbs subscribe failed:', snapshotError);
                    setError('Could not load partner climbing history.');
                    setLoading(false);
                }
            );
        });

        return () => {
            unsubs.forEach((unsub) => unsub());
        };
    }, [enabled, ownerUid, migrationCompleted, sessionsBase]);

    const activeSessions = useMemo(
        () => buildActiveSessions(migrationCompleted, sessionsBase, climbsBySession, legacyClimbs),
        [migrationCompleted, sessionsBase, climbsBySession, legacyClimbs]
    );

    const activeVisits = useMemo(() => buildActiveVisits(activeSessions), [activeSessions]);

    return {
        activeVisits,
        loading,
        error
    };
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
    const partnerUid = getPartnerUid(user?.uid);
    const isCoupleAccount = isCoupleAccountByUid(user?.uid);
    const viewerDisplayName = getDisplayNameForUid(user?.uid);
    const partnerDisplayName = getDisplayNameForUid(partnerUid);
    const comparisonToggleActiveColor = getColorForClimber(partnerDisplayName);

    const [timeRange, setTimeRange] = useState('ALL');
    const [climbType, setClimbType] = useState('boulder');
    const [chartMode, setChartMode] = useState(SOLO_CHART_MODE);
    const [showGradeTooltip, setShowGradeTooltip] = useState(false);
    const [gradeTooltipPos, setGradeTooltipPos] = useState({ top: 0, left: 0 });

    const [showLogModal, setShowLogModal] = useState(false);
    const [showHistoryModal, setShowHistoryModal] = useState(false);
    const [showEditSessionModal, setShowEditSessionModal] = useState(false);
    const [showEditClimbModal, setShowEditClimbModal] = useState(false);
    const [historyView, setHistoryView] = useState('sessions');
    const [selectedHistoryGymKey, setSelectedHistoryGymKey] = useState('');

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
    const [savedGymsByPlaceId, setSavedGymsByPlaceId] = useState({});

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
    const [expandedTextFields, setExpandedTextFields] = useState({});

    const [placesReady, setPlacesReady] = useState(false);
    const [placesLoading, setPlacesLoading] = useState(false);
    const autocompleteServiceRef = useRef(null);
    const placesServiceRef = useRef(null);
    const placesContainerRef = useRef(null);
    const gradeInfoBtnRef = useRef(null);
    const gymSearchRequestRef = useRef(0);
    const editGymSearchRequestRef = useRef(0);
    const countryCodeRef = useRef(getPreferredCountryCode());

    const isLegacyMode = isMigrationChecked && !migrationCompleted;
    const canCompareClimbs = isCoupleAccount && climbType === 'boulder';

    const {
        activeVisits: partnerActiveVisits,
        loading: partnerHistoryLoading,
        error: partnerHistoryError
    } = useReadOnlyClimbingVisits(partnerUid, isCoupleAccount);

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
        if (!supportsDisciplineTooltip(climbType)) setShowGradeTooltip(false);
        if (climbType !== 'boulder') setChartMode(SOLO_CHART_MODE);
    }, [climbType]);

    const updateGradeTooltipPosition = () => {
        if (!gradeInfoBtnRef.current || typeof window === 'undefined') return;
        const rect = gradeInfoBtnRef.current.getBoundingClientRect();
        const horizontalMargin = 12;
        const tooltipWidth = Math.min(500, window.innerWidth - horizontalMargin * 2);
        let left = rect.left + rect.width / 2 - tooltipWidth / 2;
        left = Math.max(horizontalMargin, Math.min(left, window.innerWidth - tooltipWidth - horizontalMargin));
        setGradeTooltipPos({
            top: rect.bottom + 10,
            left
        });
    };

    const openGradeTooltip = () => {
        updateGradeTooltipPosition();
        setShowGradeTooltip(true);
    };

    const closeGradeTooltip = () => {
        setShowGradeTooltip(false);
    };

    useEffect(() => {
        if (!showGradeTooltip) return undefined;
        const handleLayoutChange = () => updateGradeTooltipPosition();
        window.addEventListener('resize', handleLayoutChange);
        window.addEventListener('scroll', handleLayoutChange, true);
        return () => {
            window.removeEventListener('resize', handleLayoutChange);
            window.removeEventListener('scroll', handleLayoutChange, true);
        };
    }, [showGradeTooltip]);

    useEffect(() => {
        if (!user) {
            setGymNicknameMap({});
            setSavedGymsByPlaceId({});
            return undefined;
        }

        const nicknamesRef = collection(db, 'users', user.uid, 'gym_nicknames');
        const unsub = onSnapshot(nicknamesRef, (snapshot) => {
            const nextMap = {};
            const nextSavedGyms = {};
            snapshot.docs.forEach((snapshotDoc) => {
                const data = snapshotDoc.data() || {};
                if (typeof data.placeId === 'string' && typeof data.nickname === 'string' && data.nickname.trim()) {
                    const trimmedNickname = data.nickname.trim();
                    nextMap[data.placeId] = trimmedNickname;
                    nextSavedGyms[data.placeId] = {
                        placeId: data.placeId,
                        nickname: trimmedNickname,
                        gymName: typeof data.gymName === 'string' ? data.gymName : '',
                        gymAddress: typeof data.gymAddress === 'string' ? data.gymAddress : '',
                        lat: Number.isFinite(data.gymLat) ? data.gymLat : null,
                        lng: Number.isFinite(data.gymLng) ? data.gymLng : null
                    };
                }
            });
            setGymNicknameMap(nextMap);
            setSavedGymsByPlaceId(nextSavedGyms);
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
                    gymLat: Number.isFinite(gym.lat) ? gym.lat : null,
                    gymLng: Number.isFinite(gym.lng) ? gym.lng : null,
                    updatedAt: serverTimestamp()
                },
                { merge: true }
            );
        } catch (error) {
            console.warn('Could not store gym nickname mapping:', error);
        }
    };

    const savedGymSuggestions = useMemo(() => {
        return Object.values(savedGymsByPlaceId)
            .filter((gym) => gym?.placeId)
            .sort((a, b) => {
                const aLabel = (a.nickname || a.gymName || '').trim();
                const bLabel = (b.nickname || b.gymName || '').trim();
                return aLabel.localeCompare(bLabel, undefined, { sensitivity: 'base' });
            });
    }, [savedGymsByPlaceId]);

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

    const activeSessions = useMemo(
        () => buildActiveSessions(migrationCompleted, sessionsBase, climbsBySession, legacyClimbs),
        [migrationCompleted, sessionsBase, climbsBySession, legacyClimbs]
    );

    const activeVisits = useMemo(() => buildActiveVisits(activeSessions), [activeSessions]);

    const historyVisits = useMemo(() => {
        return activeVisits
            .sort((a, b) => b.timestamp - a.timestamp);
    }, [activeVisits]);

    const disciplineHistoryVisits = useMemo(() => {
        return activeVisits
            .filter((visit) => visit.climbs.some((climb) => climb.type === climbType))
            .sort((a, b) => b.timestamp - a.timestamp);
    }, [activeVisits, climbType]);

    const gymSummaries = useMemo(() => {
        const grouped = new Map();

        activeVisits.forEach((visit) => {
            const gymKey = getSessionGymGroupKey(visit);
            if (!gymKey) return;

            const visitTimestamp = Number.isFinite(visit.timestamp) ? visit.timestamp : Date.now();
            const visitClimbCount = Array.isArray(visit.climbs) ? visit.climbs.length : 0;

            if (!grouped.has(gymKey)) {
                grouped.set(gymKey, {
                    key: gymKey,
                    gymPlaceId: visit.gymPlaceId || '',
                    gymName: visit.gymName || '',
                    gymAddress: visit.gymAddress || '',
                    gymNickname: visit.gymNickname || '',
                    displayLabel: getGymLabel(visit),
                    locationSnippet: getGymLocationSnippet(visit),
                    visitCount: 0,
                    climbCount: 0,
                    firstVisitTimestamp: visitTimestamp,
                    lastVisitTimestamp: visitTimestamp,
                    disciplines: new Set()
                });
            }

            const summary = grouped.get(gymKey);
            summary.visitCount += 1;
            summary.climbCount += visitClimbCount;
            visit.disciplines.forEach((type) => summary.disciplines.add(type));
            summary.firstVisitTimestamp = Math.min(summary.firstVisitTimestamp, visitTimestamp);
            summary.lastVisitTimestamp = Math.max(summary.lastVisitTimestamp, visitTimestamp);

            if (!summary.gymPlaceId && visit.gymPlaceId) summary.gymPlaceId = visit.gymPlaceId;
            if (!summary.gymName && visit.gymName) summary.gymName = visit.gymName;
            if (!summary.gymAddress && visit.gymAddress) summary.gymAddress = visit.gymAddress;

            const nextNickname = typeof visit.gymNickname === 'string' ? visit.gymNickname.trim() : '';
            if (nextNickname && !summary.gymNickname) {
                summary.gymNickname = nextNickname;
                summary.displayLabel = getGymLabel(visit);
            } else if (!summary.displayLabel || summary.displayLabel === 'No gym') {
                summary.displayLabel = getGymLabel(visit);
            }

            if (!summary.locationSnippet) {
                summary.locationSnippet = getGymLocationSnippet(visit);
            }
        });

        return Array.from(grouped.values())
            .map((summary) => ({
                ...summary,
                disciplines: DISCIPLINE_ORDER.filter((type) => summary.disciplines.has(type))
            }))
            .sort((a, b) => {
                const aPrimary = (typeof a.gymNickname === 'string' && a.gymNickname.trim())
                    || (typeof a.gymName === 'string' && a.gymName.trim())
                    || a.displayLabel
                    || '';
                const bPrimary = (typeof b.gymNickname === 'string' && b.gymNickname.trim())
                    || (typeof b.gymName === 'string' && b.gymName.trim())
                    || b.displayLabel
                    || '';

                const primaryCompare = aPrimary.localeCompare(bPrimary, undefined, { sensitivity: 'base' });
                if (primaryCompare !== 0) return primaryCompare;

                const aSecondary = a.displayLabel || '';
                const bSecondary = b.displayLabel || '';
                const secondaryCompare = aSecondary.localeCompare(bSecondary, undefined, { sensitivity: 'base' });
                if (secondaryCompare !== 0) return secondaryCompare;

                return a.key.localeCompare(b.key, undefined, { sensitivity: 'base' });
            });
    }, [activeVisits]);

    const filteredHistoryVisits = useMemo(() => {
        if (!selectedHistoryGymKey) return historyVisits;
        return historyVisits.filter((visit) => getSessionGymGroupKey(visit) === selectedHistoryGymKey);
    }, [historyVisits, selectedHistoryGymKey]);

    const selectedHistoryGymSummary = useMemo(() => {
        if (!selectedHistoryGymKey) return null;
        return gymSummaries.find((summary) => summary.key === selectedHistoryGymKey) || null;
    }, [gymSummaries, selectedHistoryGymKey]);

    const soloChartData = useMemo(
        () => buildSoloChartData(disciplineHistoryVisits, timeRange, climbType),
        [disciplineHistoryVisits, timeRange, climbType]
    );

    const pairedChartData = useMemo(
        () => buildPairedBoulderChartData(disciplineHistoryVisits, partnerActiveVisits, timeRange),
        [disciplineHistoryVisits, partnerActiveVisits, timeRange]
    );

    const isCompareModeActive = canCompareClimbs && chartMode === COMPARE_CHART_MODE;
    const chartData = isCompareModeActive ? pairedChartData : soloChartData;
    const comparisonToggleLabel = `See ${partnerDisplayName}♡`;
    const chartBottomMargin = isCompareModeActive ? 24 : 10;
    const chartXAxisHeight = isCompareModeActive ? 36 : 26;
    const chartTickMargin = isCompareModeActive ? 10 : 4;

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
        if (!showLogModal) return;
        const queryText = gymQuery.trim();
        if (queryText.length < 2) {
            setGymSuggestions([]);
            setGymLoading(false);
            return;
        }

        if (selectedGym && (queryText === selectedGym.name || queryText === gymNickname)) {
            setGymSuggestions([]);
            setGymLoading(false);
            return;
        }

        const normalizedQuery = queryText.toLowerCase();
        const localSuggestions = savedGymSuggestions
            .filter((gym) => {
                const nickname = (gym.nickname || '').trim().toLowerCase();
                const name = (gym.gymName || '').trim().toLowerCase();
                const address = (gym.gymAddress || '').trim().toLowerCase();
                return nickname.includes(normalizedQuery) || name.includes(normalizedQuery) || address.includes(normalizedQuery);
            })
            .map(buildSavedGymSuggestion);

        if (!placesReady || !autocompleteServiceRef.current) {
            setGymSuggestions(localSuggestions);
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
                    const mappedPredictions = mapPredictions(predictions)
                        .filter((prediction) => !localSuggestions.some((local) => local.placeId === prediction.placeId));
                    setGymSuggestions([...localSuggestions, ...mappedPredictions]);
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
                    setGymSuggestions(localSuggestions);
                    setGymError('');
                    return;
                }

                setGymSuggestions(localSuggestions);
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
    }, [gymNickname, gymQuery, placesReady, savedGymSuggestions, selectedGym, showLogModal]);

    useEffect(() => {
        if (!showEditSessionModal) return;
        const queryText = editGymQuery.trim();
        if (queryText.length < 2) {
            setEditGymSuggestions([]);
            setEditGymLoading(false);
            return;
        }

        if (editSelectedGym && (queryText === editSelectedGym.name || queryText === editGymNickname)) {
            setEditGymSuggestions([]);
            setEditGymLoading(false);
            return;
        }

        const normalizedQuery = queryText.toLowerCase();
        const localSuggestions = savedGymSuggestions
            .filter((gym) => {
                const nickname = (gym.nickname || '').trim().toLowerCase();
                const name = (gym.gymName || '').trim().toLowerCase();
                const address = (gym.gymAddress || '').trim().toLowerCase();
                return nickname.includes(normalizedQuery) || name.includes(normalizedQuery) || address.includes(normalizedQuery);
            })
            .map(buildSavedGymSuggestion);

        if (!placesReady || !autocompleteServiceRef.current) {
            setEditGymSuggestions(localSuggestions);
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
                    const mappedPredictions = mapPredictions(predictions)
                        .filter((prediction) => !localSuggestions.some((local) => local.placeId === prediction.placeId));
                    setEditGymSuggestions([...localSuggestions, ...mappedPredictions]);
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
                    setEditGymSuggestions(localSuggestions);
                    setEditGymError('');
                    return;
                }

                setEditGymSuggestions(localSuggestions);
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
    }, [editGymNickname, editGymQuery, editSelectedGym, placesReady, savedGymSuggestions, showEditSessionModal]);

    useEffect(() => {
        return () => {
            if (placesContainerRef.current?.parentNode) {
                placesContainerRef.current.parentNode.removeChild(placesContainerRef.current);
            }
        };
    }, []);

    const resolveGymSuggestion = (suggestion, setLoading, setSelected, setQuery, setSuggestions, setError, setNickname) => {
        if (suggestion?.isSavedGym && suggestion.savedGym) {
            setSelected({
                placeId: suggestion.savedGym.placeId || '',
                name: suggestion.savedGym.name || suggestion.primaryText || '',
                address: suggestion.savedGym.address || '',
                lat: Number.isFinite(suggestion.savedGym.lat) ? suggestion.savedGym.lat : null,
                lng: Number.isFinite(suggestion.savedGym.lng) ? suggestion.savedGym.lng : null
            });
            setNickname(getRememberedNickname(suggestion.savedGym.placeId || ''));
            setQuery(suggestion.savedGym.name || suggestion.primaryText || '');
            setSuggestions([]);
            setError('');
            return;
        }

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
                        type: climb.type || rep.type || 'boulder',
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
        setExpandedTextFields({});
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
                    type: climbType,
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
                    type: climbType,
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
        setExpandedTextFields((prev) => {
            const next = { ...prev };
            delete next.editSessionNote;
            return next;
        });
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
            const sessionIds = Array.isArray(editingSession.sourceSessionIds) && editingSession.sourceSessionIds.length > 0
                ? editingSession.sourceSessionIds
                : [editingSession.id];
            const batch = writeBatch(db);
            sessionIds.forEach((sessionId) => {
                batch.update(doc(db, 'users', user.uid, 'climbing_sessions', sessionId), payload);
            });
            await batch.commit();
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
        setExpandedTextFields((prev) => {
            const next = { ...prev };
            delete next.editClimbRemark;
            return next;
        });
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

        payload.type = editingClimbType;
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
        if (!window.confirm('Delete this visit and all climbs in it?')) return;

        try {
            const sessionIds = Array.isArray(session.sourceSessionIds) && session.sourceSessionIds.length > 0
                ? session.sourceSessionIds
                : [session.id];

            for (const sessionId of sessionIds) {
                const climbs = climbsBySession[sessionId] || [];
                for (let start = 0; start < climbs.length; start += BATCH_CHUNK_SIZE) {
                    const batch = writeBatch(db);
                    const chunk = climbs.slice(start, start + BATCH_CHUNK_SIZE);
                    chunk.forEach((climb) => {
                        batch.delete(doc(db, 'users', user.uid, 'climbing_sessions', sessionId, 'climbs', climb.id));
                    });
                    await batch.commit();
                }
                await deleteDoc(doc(db, 'users', user.uid, 'climbing_sessions', sessionId));
            }
        } catch (error) {
            console.error('Delete session failed:', error);
        }
    };

    const closeHistoryModal = () => {
        setShowHistoryModal(false);
        setHistoryView('sessions');
        setSelectedHistoryGymKey('');
        closeEditSessionModal();
        closeEditClimbModal();
    };

    const openHistoryModal = () => {
        setHistoryView('sessions');
        setSelectedHistoryGymKey('');
        setShowHistoryModal(true);
    };

    const handleViewGymSessions = (gymKey) => {
        setSelectedHistoryGymKey(gymKey);
        setHistoryView('sessions');
    };

    const renderExpandableTextField = ({ fieldKey, value, onChange, placeholder, maxLength }) => {
        const isExpanded = Boolean(expandedTextFields[fieldKey]);
        const commonProps = {
            value,
            onChange: (e) => onChange(e.target.value),
            className: `climb-date-input climb-note-input${isExpanded ? ' expanded' : ''}`,
            placeholder,
            maxLength,
            title: 'Double-click to expand'
        };

        if (isExpanded) {
            return (
                <textarea
                    {...commonProps}
                    rows={4}
                    onDoubleClick={() => setExpandedTextFields((prev) => ({ ...prev, [fieldKey]: false }))}
                />
            );
        }

        return (
            <input
                {...commonProps}
                type="text"
                onDoubleClick={() => setExpandedTextFields((prev) => ({ ...prev, [fieldKey]: true }))}
            />
        );
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
    const isRopeType = climbType === 'top_rope' || climbType === 'lead';
    const isSpeedType = climbType === 'speed';
    const isDisciplineTooltipSupported = supportsDisciplineTooltip(climbType);

    return (
        <div className="climbing-tracker-container">
            <div className="climb-top-bar">
                <div className="climb-title-group">
                    <h2 className="climb-title">Climbing Tracker</h2>
                    <div className="climb-subtitle-row">
                        <span className="climb-subtitle">The only way is up.</span>
                        {isDisciplineTooltipSupported && (
                            <div className="vscale-info-wrap">
                                <button
                                    type="button"
                                    className="vscale-info-btn"
                                    aria-label="About climbing grade scale"
                                    ref={gradeInfoBtnRef}
                                    onMouseEnter={openGradeTooltip}
                                    onMouseLeave={closeGradeTooltip}
                                    onFocus={openGradeTooltip}
                                    onBlur={closeGradeTooltip}
                                >
                                    i
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                <div className="climb-header-controls">
                    <div className="climb-type-controls">
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
                            className="climb-history-btn-top climb-history-btn-top--history"
                            onClick={openHistoryModal}
                        >
                            Show History
                        </button>
                        {canCompareClimbs && (
                            <button
                                type="button"
                                className={`climb-history-btn-top climb-history-btn-top--compare ${isCompareModeActive ? 'active' : ''}`}
                                onClick={() => setChartMode((prev) => (
                                    prev === COMPARE_CHART_MODE ? SOLO_CHART_MODE : COMPARE_CHART_MODE
                                ))}
                                style={isCompareModeActive ? {
                                    background: comparisonToggleActiveColor,
                                    borderColor: comparisonToggleActiveColor,
                                    color: '#fff'
                                } : undefined}
                            >
                                {comparisonToggleLabel}
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {showGradeTooltip && createPortal(
                <div
                    className="vscale-info-popover"
                    style={{ top: `${gradeTooltipPos.top}px`, left: `${gradeTooltipPos.left}px` }}
                >
                    {isSpeedType ? (
                        <p>
                            <strong>Speed climbing</strong> is a race on a standardized <strong>15 m wall</strong> with two identical lanes.
                            At IFSC events, climbers race on the same fixed route every time, so results are directly comparable.
                            The official wall overhangs by <strong>5°</strong> and uses <strong>31 holds per lane</strong> (<strong>20 handholds + 11 footholds</strong>).
                            As of <strong>March 6, 2026</strong>, IFSC world records are <strong>4.64s</strong> by <strong>Samuel Watson (USA)</strong> set on <strong>May 3, 2025</strong>,
                            and <strong>6.03s</strong> by <strong>Aleksandra Miroslaw (POL)</strong> set on <strong>September 24, 2025</strong>.
                        </p>
                    ) : isRopeType ? (
                        <p>
                            The <strong>Yosemite Decimal System (YDS)</strong> is the grading scale used for <strong>top rope and lead</strong> route difficulty.
                            YDS has <strong>Classes 1 to 5</strong>: <strong>Class 1-4</strong> covers hiking and scrambling (progressing from walking to steeper terrain
                            where hands may be used), while <strong>Class 5</strong> is technical roped climbing. In this tracker, roped climbs use <strong>Class 5</strong> grades,
                            usually from about <strong>5.6 (easier)</strong> to <strong>5.15d (hardest)</strong>. Within a number grade, letters <strong>a-d</strong> show finer
                            steps (<strong>a easiest, d hardest</strong>). The system was developed in <strong>Yosemite Valley, California</strong> and became the U.S. standard for
                            roped climbing grades.
                        </p>
                    ) : (
                        <p>
                            The <strong>V scale</strong>, aka the Hueco scale, is a rating system for bouldering
                            difficulty, currently ranging from VB (easiest) to V17 (hardest). It originated in the
                            late 1980s and early 1990s in <strong>Hueco Tanks, Texas</strong>, where American climber <strong>John "Vermin" Sherman</strong> developed the system to describe the difficulty of short, powerful boulder problems that were
                            not well represented by traditional rope-climbing grades.
                        </p>
                    )}
                    <img
                        src={isSpeedType ? speedWallStandard : isRopeType ? ydsUsMap : blankUsMap}
                        alt={isSpeedType
                            ? 'Diagram of a standardized 15 meter speed climbing wall with two identical lanes'
                            : isRopeType
                            ? 'Map of the United States highlighting California and Yosemite Valley'
                            : 'Map of the United States showing state boundaries'}
                        className="vscale-info-map"
                    />
                </div>,
                document.body
            )}

            <div className="chart-area">
                {isCompareModeActive && (
                    <div className="climb-compare-panel">
                        <div className="climb-compare-legend">
                            <span className="climb-compare-legend-item">
                                <span
                                    className="climb-compare-legend-swatch"
                                    style={{ backgroundColor: getColorForClimber(viewerDisplayName) }}
                                />
                                {viewerDisplayName}
                            </span>
                            <span className="climb-compare-legend-item">
                                <span
                                    className="climb-compare-legend-swatch"
                                    style={{ backgroundColor: getColorForClimber(partnerDisplayName) }}
                                />
                                {partnerDisplayName}
                            </span>
                        </div>
                        {partnerHistoryLoading && (
                            <p className="climb-compare-status">Loading {partnerDisplayName}&rsquo;s climbing history...</p>
                        )}
                        {partnerHistoryError && (
                            <p className="climb-compare-status climb-compare-status--warning">
                                Comparison is unavailable until Firestore rules allow read-only access to {partnerDisplayName}&rsquo;s climbing history.
                            </p>
                        )}
                    </div>
                )}
                <ResponsiveContainer width="100%" height="100%">
                    {climbType === 'speed' ? (
                        <LineChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: chartBottomMargin }}>
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
                                tickMargin={chartTickMargin}
                                height={chartXAxisHeight}
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
                    ) : isCompareModeActive ? (
                        <BarChart data={chartData} margin={{ top: 10, right: 0, left: 0, bottom: chartBottomMargin }} barGap={6} barCategoryGap="24%">
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eee" />
                            <XAxis
                                dataKey="grade"
                                tickLine={false}
                                axisLine={{ stroke: '#eee' }}
                                tick={{ fontSize: 10, fill: '#666' }}
                                interval={timeRange === 'ALL' ? 'preserveStartEnd' : 0}
                                tickMargin={chartTickMargin}
                                height={chartXAxisHeight}
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
                                formatter={(value, name) => [value, name]}
                            />
                            <Bar dataKey="viewerCount" name={viewerDisplayName} fill={getColorForClimber(viewerDisplayName)} radius={[4, 4, 0, 0]} />
                            <Bar dataKey="partnerCount" name={partnerDisplayName} fill={getColorForClimber(partnerDisplayName)} radius={[4, 4, 0, 0]} />
                        </BarChart>
                    ) : (
                        <BarChart data={chartData} margin={{ top: 10, right: 0, left: 0, bottom: chartBottomMargin }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eee" />
                            <XAxis
                                dataKey="grade"
                                tickLine={false}
                                axisLine={{ stroke: '#eee' }}
                                tick={{ fontSize: 10, fill: '#666' }}
                                interval={timeRange === 'ALL' ? 'preserveStartEnd' : 0}
                                tickMargin={chartTickMargin}
                                height={chartXAxisHeight}
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

            <div className="climb-time-range-row">
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
                                        {renderExpandableTextField({
                                            fieldKey: 'logRouteRemark',
                                            value: logRouteRemark,
                                            onChange: setLogRouteRemark,
                                            placeholder: 'Route remark (optional), e.g. New beta / route name',
                                            maxLength: ROUTE_REMARK_MAX
                                        })}
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div className="form-group climb-remark-group">
                                        {renderExpandableTextField({
                                            fieldKey: 'logSessionNote',
                                            value: logSessionNote,
                                            onChange: setLogSessionNote,
                                            placeholder: 'Session note (optional), e.g. Not feeling great',
                                            maxLength: SESSION_NOTE_MAX
                                        })}
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

                        <div className="history-view-toggle" role="tablist" aria-label="History views">
                            <button
                                type="button"
                                className={`history-view-tab ${historyView === 'sessions' ? 'active' : ''}`}
                                onClick={() => setHistoryView('sessions')}
                            >
                                Sessions ({historyVisits.length})
                            </button>
                            <button
                                type="button"
                                className={`history-view-tab ${historyView === 'gyms' ? 'active' : ''}`}
                                onClick={() => setHistoryView('gyms')}
                            >
                                Gyms ({gymSummaries.length})
                            </button>
                        </div>

                        {historyView === 'sessions' && selectedHistoryGymSummary && (
                            <div className="history-active-filter">
                                <span className="history-active-filter-label">
                                    Gym filter: {selectedHistoryGymSummary.displayLabel}
                                </span>
                                <button
                                    type="button"
                                    className="history-clear-filter-btn"
                                    onClick={() => setSelectedHistoryGymKey('')}
                                >
                                    Clear
                                </button>
                            </div>
                        )}

                        <div className="history-list">
                            {historyView === 'gyms' ? (
                                gymSummaries.length === 0 ? (
                                    <p className="empty-message">No gyms logged yet. Add a gym when you log a climb.</p>
                                ) : (
                                    gymSummaries.map((gym) => (
                                        <div key={gym.key} className="history-gym-card">
                                            <div className="history-gym-header">
                                                <div className="history-gym-header-left">
                                                    <div className="history-gym-title">{gym.displayLabel}</div>
                                                    {gym.locationSnippet && (
                                                        <div className="history-gym-location" title={gym.locationSnippet}>
                                                            {gym.locationSnippet}
                                                        </div>
                                                    )}
                                                </div>
                                                <button
                                                    type="button"
                                                    className="edit-log-btn"
                                                    onClick={() => handleViewGymSessions(gym.key)}
                                                >
                                                    View Sessions
                                                </button>
                                            </div>

                                            <div className="history-gym-badges">
                                                {gym.disciplines.map((type) => (
                                                    <span key={type} className={`history-discipline-pill ${type}`}>
                                                        {getDisciplineLabel(type)}
                                                    </span>
                                                ))}
                                            </div>

                                            <div className="history-gym-stats">
                                                <div className="history-gym-stat">
                                                    <span className="history-gym-stat-label">Visits</span>
                                                    <span className="history-gym-stat-value">{gym.visitCount}</span>
                                                </div>
                                                <div className="history-gym-stat">
                                                    <span className="history-gym-stat-label">Climbs</span>
                                                    <span className="history-gym-stat-value">{gym.climbCount}</span>
                                                </div>
                                                <div className="history-gym-stat">
                                                    <span className="history-gym-stat-label">First Visit</span>
                                                    <span className="history-gym-stat-value">{formatDateKeyAsUs(getDateKeyFromTimestamp(gym.firstVisitTimestamp))}</span>
                                                </div>
                                                <div className="history-gym-stat">
                                                    <span className="history-gym-stat-label">Last Visit</span>
                                                    <span className="history-gym-stat-value">{formatDateKeyAsUs(getDateKeyFromTimestamp(gym.lastVisitTimestamp))}</span>
                                                </div>
                                            </div>
                                        </div>
                                    ))
                                )
                            ) : (
                                filteredHistoryVisits.length === 0 ? (
                                    <p className="empty-message">
                                        {selectedHistoryGymSummary
                                            ? `No visits logged at ${selectedHistoryGymSummary.displayLabel} yet.`
                                            : 'No climbs logged yet. Go send some rocks!'}
                                    </p>
                                ) : (
                                    filteredHistoryVisits.map((session) => (
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
                                                    Edit Visit
                                                </button>
                                                <button
                                                    className="delete-log-btn"
                                                    onClick={() => handleDeleteSession(session)}
                                                    disabled={session.legacy}
                                                >
                                                    Delete Visit
                                                </button>
                                            </div>
                                        </div>

                                        <div className="history-session-climbs">
                                            {session.climbs.length === 0 ? (
                                                <div className="history-empty-session">No climbs in this visit.</div>
                                            ) : (
                                                session.climbs.map((climb) => (
                                                    <div key={`${climb.sessionId || session.id}-${climb.id}`} className="history-session-climb-row">
                                                        <div className="history-session-climb-main">
                                                            <span className={`history-discipline-pill ${climb.type}`}>
                                                                {getDisciplineLabel(climb.type)}
                                                            </span>
                                                            {(() => {
                                                                const badgeColor = climb.type === 'speed'
                                                                    ? '#f59e0b'
                                                                    : (typeof climb.grade === 'string' ? getBarColorByType(climb.type, climb.grade) : '#94a3b8');
                                                                const speedTime = Number.parseFloat(climb.time);
                                                                const badgeLabel = climb.type === 'speed'
                                                                    ? (Number.isFinite(speedTime) ? `${speedTime}s` : '-')
                                                                    : (climb.grade || '-');
                                                                return (
                                                                    <span className="history-grade" style={{ backgroundColor: badgeColor }}>
                                                                        {badgeLabel}
                                                                    </span>
                                                                );
                                                            })()}
                                                            <span className={`history-route-remark ${climb.remark ? '' : 'empty'}`} title={climb.remark || ''}>
                                                                {climb.remark || ''}
                                                            </span>
                                                        </div>
                                                        <div className="history-item-actions">
                                                            <button
                                                                className="edit-log-btn"
                                                                onClick={() => openEditClimbModal(climb.sessionId || session.id, climb.type, climb)}
                                                                disabled={climb.legacy}
                                                            >
                                                                Edit
                                                            </button>
                                                            <button
                                                                className="delete-log-btn"
                                                                onClick={() => handleDeleteClimb(climb.sessionId || session.id, climb.id, climb.legacy)}
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
                                )
                            )}
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {showEditSessionModal && createPortal(
                <div className="climb-modal-overlay" onClick={closeEditSessionModal}>
                    <div className="climb-modal edit-session-modal" onClick={(e) => e.stopPropagation()}>
                        <h3>Edit Visit</h3>
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
                                {renderExpandableTextField({
                                    fieldKey: 'editSessionNote',
                                    value: editSessionNote,
                                    onChange: setEditSessionNote,
                                    placeholder: 'Session note (optional), e.g. Not feeling great',
                                    maxLength: SESSION_NOTE_MAX
                                })}
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
                                {renderExpandableTextField({
                                    fieldKey: 'editClimbRemark',
                                    value: editClimbRemark,
                                    onChange: setEditClimbRemark,
                                    placeholder: 'Route remark (optional), e.g. New beta / route name',
                                    maxLength: ROUTE_REMARK_MAX
                                })}
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
