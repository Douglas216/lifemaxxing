import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
    onSnapshot,
    collection,
    query,
    where,
    setDoc,
    doc,
    deleteDoc,
    orderBy
} from 'firebase/firestore';
import {
    ResponsiveContainer,
    LineChart,
    Line,
    XAxis,
    YAxis,
    Tooltip
} from 'recharts';
import { useAuth } from '../context/AuthContext';
import { db } from '../firebase';
import './StrengthTracker.css';

import BenchIcon from '../assets/bench_press.svg';
import SquatIcon from '../assets/squat.svg';
import DeadliftIcon from '../assets/deadlift.svg.svg';

const WEIGHT_EXERCISES = [
    { key: 'bench', label: 'Bench Press', iconType: 'image', iconSrc: BenchIcon, iconAlt: 'Bench' },
    { key: 'squat', label: 'Squat', iconType: 'image', iconSrc: SquatIcon, iconAlt: 'Squat' },
    { key: 'deadlift', label: 'Deadlift', iconType: 'image', iconSrc: DeadliftIcon, iconAlt: 'Deadlift' },
    { key: 'ohp', label: 'Barbell Overhead Press', iconType: 'emoji', emoji: '🏋️' },
    { key: 'latPulldown', label: 'Lat Pulldown', iconType: 'emoji', emoji: '🦅' },
    { key: 'weightedPullup', label: 'Weighted Pullups', iconType: 'emoji', emoji: '🎯' },
    { key: 'seatedCableRow', label: 'Seated Cable Row', iconType: 'emoji', emoji: '🚣' }
];

const REP_EXERCISES = [
    { key: 'pushup', label: 'Push-up', iconType: 'emoji', emoji: '💪' },
    { key: 'pullup', label: 'Pull-up', iconType: 'emoji', emoji: '🧗' },
    { key: 'muscleup', label: 'Muscle-up', iconType: 'emoji', emoji: '🚀' }
];

const HOLD_EXERCISES = [
    { key: 'plank', label: 'Plank', iconType: 'emoji', emoji: '🧱' },
    { key: 'deadHang', label: 'Dead Hang', iconType: 'emoji', emoji: '🖐️' },
    { key: 'handstand', label: 'Handstand', iconType: 'emoji', emoji: '🤸' }
];

const EXERCISES_BY_MODE = {
    weight: WEIGHT_EXERCISES,
    rep: REP_EXERCISES,
    hold: HOLD_EXERCISES
};

const ALL_EXERCISES = [...WEIGHT_EXERCISES, ...REP_EXERCISES, ...HOLD_EXERCISES];

const EXERCISE_LABEL_LOOKUP = ALL_EXERCISES.reduce((acc, exercise) => {
    acc[exercise.key] = exercise.label;
    return acc;
}, {});

const PR_MODE_OPTIONS = [
    { key: 'weight', label: 'Weight PR' },
    { key: 'rep', label: 'Rep PR' },
    { key: 'hold', label: 'Hold PR' }
];

const MODE_LABEL_LOOKUP = PR_MODE_OPTIONS.reduce((acc, mode) => {
    acc[mode.key] = mode.label;
    return acc;
}, {});

const HISTORY_MODE_OPTIONS = [
    { key: 'ALL', label: 'All Modes' },
    ...PR_MODE_OPTIONS
];

const DEAD_HANG_LIFT = 'deadHang';
const DEAD_HANG_VARIANTS = [
    { key: 'left', label: 'Left' },
    { key: 'both', label: 'Both' },
    { key: 'right', label: 'Right' }
];
const DEAD_HANG_VARIANT_LOOKUP = DEAD_HANG_VARIANTS.reduce((acc, variant) => {
    acc[variant.key] = variant.label;
    return acc;
}, {});

const RM_OPTIONS = ['1rm', '5rm', '10rm', '20rm'];
const PAGE_SIZE = 3;
const SWIPE_THRESHOLD = 50;
const TRACKPAD_SWIPE_THRESHOLD = 60;
const TRACKPAD_SWIPE_COOLDOWN_MS = 280;
const TRACKPAD_RESET_WINDOW_MS = 180;

const getTodayDateKey = () => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const normalizeMode = (value) => {
    if (value === 'rep' || value === 'hold' || value === 'weight') return value;
    return 'weight';
};

const getMetricTypeForMode = (mode) => {
    if (mode === 'rep') return 'reps';
    if (mode === 'hold') return 'holdSeconds';
    return 'weightKg';
};

const isDeadHangLift = (lift, mode) => lift === DEAD_HANG_LIFT && mode === 'hold';

const normalizeDeadHangVariant = (value) => {
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (DEAD_HANG_VARIANT_LOOKUP[normalized]) return normalized;
    }
    return 'both';
};

const createDeadHangVariantState = (createValue) => DEAD_HANG_VARIANTS.reduce((acc, variant) => {
    acc[variant.key] = createValue();
    return acc;
}, {});

const createEmptyHistoryState = (keys) => keys.reduce((acc, key) => {
    acc[key] = key === DEAD_HANG_LIFT ? createDeadHangVariantState(() => []) : [];
    return acc;
}, {});

const createEmptyDailyLookup = (keys) => keys.reduce((acc, key) => {
    acc[key] = key === DEAD_HANG_LIFT ? createDeadHangVariantState(() => ({})) : {};
    return acc;
}, {});

const createEmptyMaxState = (keys) => keys.reduce((acc, key) => {
    acc[key] = key === DEAD_HANG_LIFT ? createDeadHangVariantState(() => 0) : 0;
    return acc;
}, {});

const getNumericValue = (entry) => {
    if (typeof entry?.value === 'number' && Number.isFinite(entry.value)) return entry.value;
    if (typeof entry?.weight === 'number' && Number.isFinite(entry.weight)) return entry.weight;

    const parsedValue = Number.parseFloat(entry?.value);
    if (Number.isFinite(parsedValue)) return parsedValue;

    const parsedWeight = Number.parseFloat(entry?.weight);
    if (Number.isFinite(parsedWeight)) return parsedWeight;

    return 0;
};

const formatHoldDuration = (seconds) => {
    const safeSeconds = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0));
    const mins = Math.floor(safeSeconds / 60);
    const secs = safeSeconds % 60;
    return `${mins}:${String(secs).padStart(2, '0')}`;
};

const StrengthTracker = () => {
    const { user } = useAuth();

    const [unit, setUnit] = useState(() => localStorage.getItem('strength_unit') || 'kg');
    const [timeRange, setTimeRange] = useState('ALL');
    const [rmType, setRmType] = useState('1rm');
    const [prMode, setPrMode] = useState('weight');
    const [selectedDeadHangVariant, setSelectedDeadHangVariant] = useState('both');

    const activeExercises = useMemo(() => EXERCISES_BY_MODE[prMode] || [], [prMode]);
    const activeExerciseKeys = useMemo(() => activeExercises.map(exercise => exercise.key), [activeExercises]);

    const [historyData, setHistoryData] = useState(() => createEmptyHistoryState(ALL_EXERCISES.map(exercise => exercise.key)));
    const [maxes, setMaxes] = useState(() => createEmptyMaxState(ALL_EXERCISES.map(exercise => exercise.key)));

    const [showLogModal, setShowLogModal] = useState(false);
    const [showHistoryModal, setShowHistoryModal] = useState(false);
    const [logLift, setLogLift] = useState(null);
    const [logDeadHangVariant, setLogDeadHangVariant] = useState('both');
    const [logValue, setLogValue] = useState('');
    const [logDate, setLogDate] = useState(() => getTodayDateKey());
    const [editingId, setEditingId] = useState(null);

    const [fullHistory, setFullHistory] = useState([]);

    const [historyFilterMode, setHistoryFilterMode] = useState('ALL');
    const [historyFilterLift, setHistoryFilterLift] = useState('ALL');
    const [historyDeadHangVariantFilter, setHistoryDeadHangVariantFilter] = useState('ALL');
    const [deleteId, setDeleteId] = useState(null);
    const [currentPage, setCurrentPage] = useState(0);
    const [touchStartX, setTouchStartX] = useState(null);
    const [touchEndX, setTouchEndX] = useState(null);
    const trackpadAccumRef = useRef(0);
    const trackpadLastEventRef = useRef(0);
    const trackpadCooldownRef = useRef(0);

    useEffect(() => {
        localStorage.setItem('strength_unit', unit);
    }, [unit]);

    useEffect(() => {
        setCurrentPage(0);
        setHistoryFilterLift('ALL');
    }, [prMode]);

    useEffect(() => {
        if (historyFilterLift !== DEAD_HANG_LIFT) {
            setHistoryDeadHangVariantFilter('ALL');
        }
    }, [historyFilterLift]);

    useEffect(() => {
        if (historyFilterLift === 'ALL') return;

        const validOptions = historyFilterMode === 'ALL'
            ? ALL_EXERCISES.map(exercise => exercise.key)
            : (EXERCISES_BY_MODE[historyFilterMode] || []).map(exercise => exercise.key);

        if (!validOptions.includes(historyFilterLift)) {
            setHistoryFilterLift('ALL');
        }
    }, [historyFilterMode, historyFilterLift]);

    useEffect(() => {
        if (!user) return;

        const historyRef = collection(db, 'users', user.uid, 'strength_history');
        const historyQuery = prMode === 'weight'
            ? query(historyRef, where('rmType', '==', rmType))
            : query(historyRef, where('prMode', '==', prMode));

        const unsub = onSnapshot(historyQuery, (snapshot) => {
            const raw = createEmptyDailyLookup(activeExerciseKeys);

            snapshot.docs.forEach((snapDoc) => {
                const data = snapDoc.data();
                const itemMode = normalizeMode(data.prMode);
                if (itemMode !== prMode) return;

                if (!data.lift || raw[data.lift] === undefined) return;
                const variantKey = isDeadHangLift(data.lift, itemMode)
                    ? normalizeDeadHangVariant(data.deadHangVariant)
                    : null;

                const dateObj = data.date?.toDate ? data.date.toDate() : new Date();
                const y = dateObj.getFullYear();
                const m = String(dateObj.getMonth() + 1).padStart(2, '0');
                const d = String(dateObj.getDate()).padStart(2, '0');
                const dateKey = `${y}-${m}-${d}`;

                const timestamp = dateObj.getTime();
                const dailyLookup = variantKey ? raw[data.lift][variantKey] : raw[data.lift];
                const existing = dailyLookup[dateKey];
                const value = getNumericValue(data);

                if (!existing || timestamp > existing.timestamp) {
                    dailyLookup[dateKey] = {
                        timestamp,
                        value,
                        id: snapDoc.id,
                        deadHangVariant: variantKey || undefined
                    };
                }
            });

            const processed = createEmptyHistoryState(activeExerciseKeys);
            activeExerciseKeys.forEach((key) => {
                if (key === DEAD_HANG_LIFT) {
                    DEAD_HANG_VARIANTS.forEach((variant) => {
                        processed[key][variant.key] = Object.values(raw[key][variant.key]).sort((a, b) => a.timestamp - b.timestamp);
                    });
                    return;
                }
                processed[key] = Object.values(raw[key]).sort((a, b) => a.timestamp - b.timestamp);
            });

            const newMaxes = createEmptyMaxState(activeExerciseKeys);
            activeExerciseKeys.forEach((key) => {
                if (key === DEAD_HANG_LIFT) {
                    DEAD_HANG_VARIANTS.forEach((variant) => {
                        newMaxes[key][variant.key] = Math.max(0, ...processed[key][variant.key].map((item) => item.value));
                    });
                    return;
                }
                newMaxes[key] = Math.max(0, ...processed[key].map(item => item.value));
            });

            setHistoryData(processed);
            setMaxes(newMaxes);
        });

        return () => unsub();
    }, [user, prMode, rmType, activeExerciseKeys]);

    useEffect(() => {
        if (!user || !showHistoryModal) return;

        const historyRef = collection(db, 'users', user.uid, 'strength_history');
        const historyQuery = query(historyRef, orderBy('date', 'desc'));

        const unsub = onSnapshot(historyQuery, (snapshot) => {
            const data = snapshot.docs.map((snapDoc) => {
                const item = snapDoc.data();
                const mode = normalizeMode(item.prMode);
                const dateObj = item.date?.toDate ? item.date.toDate() : new Date();
                return {
                    id: snapDoc.id,
                    ...item,
                    prMode: mode,
                    deadHangVariant: isDeadHangLift(item.lift, mode) ? normalizeDeadHangVariant(item.deadHangVariant) : null,
                    metricType: item.metricType || getMetricTypeForMode(mode),
                    value: getNumericValue(item),
                    rmType: mode === 'weight' ? (item.rmType || '1rm') : null,
                    dateObj,
                    formattedDate: dateObj.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
                };
            });
            setFullHistory(data);
        });

        return () => unsub();
    }, [user, showHistoryModal]);

    const convertWeight = (kg) => {
        const val = unit === 'kg' ? kg : kg * 2.20462;
        return parseFloat(val.toFixed(1));
    };

    const getFilteredHistory = (data) => {
        if (!data || data.length === 0) return [];
        if (timeRange === 'ALL') return data;

        const now = Date.now();
        let cutoff = 0;
        if (timeRange === '1W') cutoff = now - 7 * 24 * 60 * 60 * 1000;
        if (timeRange === '1M') cutoff = now - 30 * 24 * 60 * 60 * 1000;
        if (timeRange === '1Y') cutoff = now - 365 * 24 * 60 * 60 * 1000;

        return data.filter(item => item.timestamp >= cutoff);
    };

    const closeLogModal = () => {
        setShowLogModal(false);
        setEditingId(null);
        setLogLift(null);
        setLogDeadHangVariant('both');
        setLogValue('');
    };

    const openLogModal = (lift, variant = 'both') => {
        setEditingId(null);
        setLogLift(lift);
        setLogDeadHangVariant(isDeadHangLift(lift, prMode) ? normalizeDeadHangVariant(variant) : 'both');
        setLogValue('');
        setLogDate(getTodayDateKey());
        setShowLogModal(true);
    };

    const handleLogSave = async () => {
        if (!user || !logLift || !logDate || logValue === '') return;

        let parsedValue = Number.parseFloat(logValue);
        if (!Number.isFinite(parsedValue) || parsedValue < 0) parsedValue = 0;

        let storedValue = parsedValue;
        if (prMode === 'weight') {
            storedValue = unit === 'kg' ? parsedValue : parsedValue / 2.20462;
            storedValue = Math.round(storedValue * 100) / 100;
        } else {
            storedValue = Math.round(parsedValue);
        }

        try {
            const [y, m, d] = logDate.split('-');
            if (!y || !m || !d) return;

            const sentDate = new Date(y, m - 1, d);
            sentDate.setHours(12, 0, 0, 0);

            const dateKey = `${y}-${m}-${d}`;
            const metricKey = prMode === 'weight' ? rmType : 'max';
            const deadHangVariant = isDeadHangLift(logLift, prMode) ? normalizeDeadHangVariant(logDeadHangVariant) : null;
            const docId = deadHangVariant
                ? `${prMode}_${logLift}_${metricKey}_${deadHangVariant}_${dateKey}`
                : `${prMode}_${logLift}_${metricKey}_${dateKey}`;

            const payload = {
                lift: logLift,
                prMode,
                metricType: getMetricTypeForMode(prMode),
                value: storedValue,
                date: sentDate,
                dateKey
            };

            if (prMode === 'weight') {
                payload.rmType = rmType;
                payload.weight = storedValue;
            }
            if (deadHangVariant) {
                payload.deadHangVariant = deadHangVariant;
            }

            await setDoc(doc(db, 'users', user.uid, 'strength_history', docId), payload);

            if (editingId && editingId !== docId) {
                await deleteDoc(doc(db, 'users', user.uid, 'strength_history', editingId));
            }

            closeLogModal();
        } catch (err) {
            console.error('Error logging PR:', err);
        }
    };

    const confirmDelete = async () => {
        if (!deleteId || !user) return;
        try {
            await deleteDoc(doc(db, 'users', user.uid, 'strength_history', deleteId));
            setDeleteId(null);
        } catch (err) {
            console.error('Delete failed', err);
        }
    };

    const handleEditHistory = (item) => {
        const itemMode = normalizeMode(item.prMode);
        setPrMode(itemMode);

        if (itemMode === 'weight' && item.rmType) {
            setRmType(item.rmType);
        }

        setLogLift(item.lift);
        setLogDeadHangVariant(isDeadHangLift(item.lift, itemMode) ? normalizeDeadHangVariant(item.deadHangVariant) : 'both');
        if (itemMode === 'weight') {
            const displayValue = unit === 'kg'
                ? Math.round(item.value * 10) / 10
                : convertWeight(item.value);
            setLogValue(String(displayValue));
        } else {
            setLogValue(String(Math.max(0, Math.round(item.value))));
        }

        if (item.dateObj) {
            const year = item.dateObj.getFullYear();
            const month = String(item.dateObj.getMonth() + 1).padStart(2, '0');
            const day = String(item.dateObj.getDate()).padStart(2, '0');
            setLogDate(`${year}-${month}-${day}`);
        }

        setEditingId(item.id);
        setShowHistoryModal(false);
        setShowLogModal(true);
    };

    const formatCardValue = (value) => {
        if (!Number.isFinite(value) || value <= 0) {
            return { main: '--', unitLabel: '' };
        }

        if (prMode === 'weight') {
            return { main: convertWeight(value), unitLabel: unit };
        }

        if (prMode === 'rep') {
            return { main: Math.round(value), unitLabel: 'reps' };
        }

        return { main: formatHoldDuration(value), unitLabel: 'm:ss' };
    };

    const formatTooltipValue = (val) => {
        const numeric = Number.isFinite(val) ? val : 0;

        if (prMode === 'weight') return `${numeric} ${unit}`;
        if (prMode === 'rep') return `${Math.round(numeric)} reps`;
        return formatHoldDuration(numeric);
    };

    const formatYAxisValue = (val) => {
        const numeric = Number.isFinite(val) ? val : 0;
        if (prMode === 'weight') return Number.isInteger(numeric) ? numeric : numeric.toFixed(1);
        if (prMode === 'rep') return Math.round(numeric);
        if (numeric < 60) return `${Math.round(numeric)}s`;
        return formatHoldDuration(numeric);
    };

    const getLogModalTitle = () => {
        if (prMode === 'weight') return `Log New ${rmType.toUpperCase()} PR`;
        if (prMode === 'rep') return 'Log New Rep PR';
        return 'Log New Hold PR';
    };

    const getLogInputLabel = () => {
        if (prMode === 'weight') return `Weight (${unit})`;
        if (prMode === 'rep') return 'Reps';
        return 'Hold (seconds)';
    };

    const getLogInputPlaceholder = () => {
        if (prMode === 'weight') return `Enter weight in ${unit}`;
        if (prMode === 'rep') return 'Enter reps completed';
        return 'Enter hold time in seconds';
    };

    const cyclePrMode = () => {
        setPrMode((currentMode) => {
            const currentIndex = PR_MODE_OPTIONS.findIndex((mode) => mode.key === currentMode);
            const nextIndex = (currentIndex + 1) % PR_MODE_OPTIONS.length;
            return PR_MODE_OPTIONS[nextIndex].key;
        });
    };

    const totalKg = (maxes.bench || 0) + (maxes.squat || 0) + (maxes.deadlift || 0);
    const totalDisplay = convertWeight(totalKg);

    const cardPages = useMemo(() => {
        const pages = [];
        for (let i = 0; i < activeExercises.length; i += PAGE_SIZE) {
            pages.push(activeExercises.slice(i, i + PAGE_SIZE));
        }
        return pages;
    }, [activeExercises]);

    const historyExerciseOptions = useMemo(() => {
        if (historyFilterMode === 'ALL') return ALL_EXERCISES;
        return EXERCISES_BY_MODE[historyFilterMode] || [];
    }, [historyFilterMode]);

    const shouldShowDeadHangVariantFilter = historyFilterLift === DEAD_HANG_LIFT;

    const filteredHistory = useMemo(() => {
        return fullHistory.filter((item) => {
            const modeMatch = historyFilterMode === 'ALL' || item.prMode === historyFilterMode;
            const liftMatch = historyFilterLift === 'ALL' || item.lift === historyFilterLift;
            const variantMatch = !shouldShowDeadHangVariantFilter
                || historyDeadHangVariantFilter === 'ALL'
                || item.deadHangVariant === historyDeadHangVariantFilter;
            return modeMatch && liftMatch && variantMatch;
        });
    }, [fullHistory, historyFilterMode, historyFilterLift, historyDeadHangVariantFilter, shouldShowDeadHangVariantFilter]);

    const shouldShowHistoryUnitToggle = historyFilterMode === 'ALL' || historyFilterMode === 'weight';

    const formatHistoryRecord = (item) => {
        if (item.prMode === 'weight') {
            const rmLabel = item.rmType ? ` (${item.rmType.toUpperCase()})` : '';
            return `${convertWeight(item.value)} ${unit}${rmLabel}`;
        }
        if (item.prMode === 'rep') {
            return `${Math.max(0, Math.round(item.value))} reps`;
        }
        return formatHoldDuration(item.value);
    };

    const getDeadHangVariantLabel = (variant) => DEAD_HANG_VARIANT_LOOKUP[normalizeDeadHangVariant(variant)] || 'Both';

    const goToPage = (nextPage) => {
        const bounded = Math.max(0, Math.min(cardPages.length - 1, nextPage));
        setCurrentPage(bounded);
    };

    const goNextPage = () => goToPage(currentPage + 1);
    const goPrevPage = () => goToPage(currentPage - 1);

    const onCarouselTouchStart = (event) => {
        const x = event.changedTouches?.[0]?.clientX;
        if (typeof x !== 'number') return;
        setTouchStartX(x);
        setTouchEndX(x);
    };

    const onCarouselTouchMove = (event) => {
        const x = event.changedTouches?.[0]?.clientX;
        if (typeof x !== 'number') return;
        setTouchEndX(x);
    };

    const onCarouselTouchEnd = () => {
        if (touchStartX === null || touchEndX === null) {
            setTouchStartX(null);
            setTouchEndX(null);
            return;
        }

        const delta = touchStartX - touchEndX;
        if (Math.abs(delta) >= SWIPE_THRESHOLD) {
            if (delta > 0) goNextPage();
            if (delta < 0) goPrevPage();
        }

        setTouchStartX(null);
        setTouchEndX(null);
    };

    const onCarouselWheel = (event) => {
        const absX = Math.abs(event.deltaX);
        const absY = Math.abs(event.deltaY);
        if (absX <= absY || absX < 2) return;

        const now = Date.now();
        if (now - trackpadCooldownRef.current < TRACKPAD_SWIPE_COOLDOWN_MS) {
            event.preventDefault();
            return;
        }

        if (now - trackpadLastEventRef.current > TRACKPAD_RESET_WINDOW_MS) {
            trackpadAccumRef.current = 0;
        }
        trackpadLastEventRef.current = now;
        trackpadAccumRef.current += event.deltaX;

        if (Math.abs(trackpadAccumRef.current) >= TRACKPAD_SWIPE_THRESHOLD) {
            if (trackpadAccumRef.current > 0) goNextPage();
            if (trackpadAccumRef.current < 0) goPrevPage();
            trackpadAccumRef.current = 0;
            trackpadCooldownRef.current = now;
        }

        event.preventDefault();
    };

    const renderLiftIcon = (lift) => {
        if (lift.iconType === 'image') {
            return <img src={lift.iconSrc} alt={lift.iconAlt} style={{ width: '40px', height: '40px' }} />;
        }
        return <span role="img" aria-label={lift.label}>{lift.emoji}</span>;
    };

    return (
        <div className="strength-tracker-container">
            <div className="top-bar">
                <div className="strength-tracker-heading">
                    <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, textAlign: 'left' }}>Strength Tracker</h2>
                    <div style={{ fontSize: '0.9rem', color: 'rgba(31, 35, 51, 0.6)', marginTop: '0.25rem', textAlign: 'left' }}>
                        It's what you do in the dark that puts you in the light.
                    </div>
                </div>
                <div className="strength-tracker-top-actions">
                    <button
                        type="button"
                        className="pr-mode-cycle-btn"
                        onClick={cyclePrMode}
                        title="Click to switch PR type"
                    >
                        {MODE_LABEL_LOOKUP[prMode] || 'Weight PR'}
                    </button>
                    <button className="history-btn" onClick={() => setShowHistoryModal(true)}>
                        Show History
                    </button>
                </div>
            </div>

            <div className="strength-tracker-carousel">
                <div
                    className="strength-tracker-carousel-viewport"
                    onTouchStart={onCarouselTouchStart}
                    onTouchMove={onCarouselTouchMove}
                    onTouchEnd={onCarouselTouchEnd}
                    onWheel={onCarouselWheel}
                >
                    <div
                        className="strength-tracker-carousel-track"
                        style={{ transform: `translateX(-${currentPage * 100}%)` }}
                    >
                        {cardPages.map((page, pageIndex) => (
                            <div className="strength-tracker-page" key={`page-${pageIndex}`}>
                                <div className="strength-tracker-grid">
                                    {page.map((lift) => {
                                        const { key } = lift;
                                        const isDeadHangCard = isDeadHangLift(key, prMode);
                                        const liftHistory = isDeadHangCard
                                            ? (historyData[key]?.[selectedDeadHangVariant] || [])
                                            : (historyData[key] || []);
                                        const filteredData = getFilteredHistory(liftHistory);
                                        const chartData = filteredData.map((item) => ({
                                            ...item,
                                            displayValue: prMode === 'weight'
                                                ? convertWeight(item.value)
                                                : Math.round(item.value)
                                        }));

                                        const chartTicks = chartData.map((item) => item.timestamp);
                                        const rawMaxValue = isDeadHangCard
                                            ? (maxes[key]?.[selectedDeadHangVariant] || 0)
                                            : maxes[key];
                                        const valueDisplay = formatCardValue(rawMaxValue);

                                        return (
                                            <div key={key} className="lift-card">
                                                <span className="lift-icon">{renderLiftIcon(lift)}</span>
                                                <span className="lift-label">{lift.label}</span>
                                                {isDeadHangCard && (
                                                    <div className="dead-hang-variant-switch" role="tablist" aria-label="Dead hang hand selection">
                                                        {DEAD_HANG_VARIANTS.map((variant) => (
                                                            <button
                                                                key={variant.key}
                                                                type="button"
                                                                className={`dead-hang-variant-btn ${selectedDeadHangVariant === variant.key ? 'active' : ''}`}
                                                                onClick={() => setSelectedDeadHangVariant(variant.key)}
                                                            >
                                                                {variant.label}
                                                            </button>
                                                        ))}
                                                    </div>
                                                )}

                                                <div
                                                    className="lift-value-display"
                                                    style={{ cursor: 'default', pointerEvents: 'none' }}
                                                >
                                                    {valueDisplay.main}
                                                    <div className="unit-label">{valueDisplay.unitLabel}</div>
                                                </div>

                                                <button className="log-pr-btn" onClick={() => openLogModal(key, isDeadHangCard ? selectedDeadHangVariant : 'both')}>
                                                    Log New PR
                                                </button>

                                                <div className="chart-container-expanded">
                                                    {chartData.length > 1 ? (
                                                        <ResponsiveContainer width="100%" height="100%">
                                                            <LineChart data={chartData}>
                                                                <XAxis
                                                                    dataKey="timestamp"
                                                                    type="number"
                                                                    domain={['dataMin', 'dataMax']}
                                                                    tickFormatter={(ts) => new Date(ts).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })}
                                                                    tick={{ fontSize: 10, fill: '#aaa' }}
                                                                    tickLine={false}
                                                                    axisLine={false}
                                                                    interval="preserveStartEnd"
                                                                    ticks={chartTicks}
                                                                />
                                                                <YAxis
                                                                    domain={['auto', 'auto']}
                                                                    tick={{ fontSize: 10, fill: '#aaa' }}
                                                                    tickLine={false}
                                                                    axisLine={false}
                                                                    width={46}
                                                                    allowDecimals={prMode !== 'rep'}
                                                                    tickFormatter={formatYAxisValue}
                                                                    tickCount={prMode === 'rep' ? 6 : undefined}
                                                                />
                                                                <Tooltip
                                                                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                                                                    labelFormatter={(ts) => new Date(ts).toLocaleDateString()}
                                                                    formatter={(val) => [formatTooltipValue(val), MODE_LABEL_LOOKUP[prMode]]}
                                                                />
                                                                <Line
                                                                    type="monotone"
                                                                    dataKey="displayValue"
                                                                    stroke="#395aff"
                                                                    strokeWidth={3}
                                                                    dot={{ r: 4, fill: '#395aff', strokeWidth: 2, stroke: '#fff' }}
                                                                    activeDot={{ r: 6 }}
                                                                />
                                                            </LineChart>
                                                        </ResponsiveContainer>
                                                    ) : (
                                                        <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.3, fontSize: '0.8em' }}>
                                                            {chartData.length === 1 ? 'Log more to see trend' : 'No history'}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {cardPages.length > 1 && (
                    <div className="strength-tracker-carousel-nav">
                        <button
                            type="button"
                            className="strength-tracker-page-arrow"
                            onClick={goPrevPage}
                            disabled={currentPage === 0}
                            aria-label="Show previous lifts"
                        >
                            ←
                        </button>
                        <div className="strength-tracker-page-dots">
                            {cardPages.map((_, index) => (
                                <button
                                    type="button"
                                    key={`dot-${index}`}
                                    className={`strength-tracker-page-dot ${currentPage === index ? 'active' : ''}`}
                                    onClick={() => goToPage(index)}
                                    aria-label={`Show lift page ${index + 1}`}
                                />
                            ))}
                        </div>
                        <button
                            type="button"
                            className="strength-tracker-page-arrow"
                            onClick={goNextPage}
                            disabled={currentPage === cardPages.length - 1}
                            aria-label="Show next lifts"
                        >
                            →
                        </button>
                    </div>
                )}
            </div>

            <div className="strength-tracker-controls">
                <div className="strength-tracker-controls-left">
                    {prMode === 'weight' && (
                        <div className="rm-controls rm-controls-left">
                            {RM_OPTIONS.map((rm) => (
                                <button
                                    key={rm}
                                    className={`rm-toggle-btn ${rmType === rm ? 'active' : ''}`}
                                    onClick={() => setRmType(rm)}
                                >
                                    {rm.toUpperCase()}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
                <div className="strength-tracker-controls-center">
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
                <div className="strength-tracker-controls-right">
                    {prMode === 'weight' && (
                        <button
                            className="unit-toggle-btn"
                            onClick={() => setUnit(unit === 'kg' ? 'lb' : 'kg')}
                        >
                            Unit: {unit.toUpperCase()}
                        </button>
                    )}
                </div>
            </div>

            {prMode === 'weight' && (
                <div className="strength-tracker-total">
                    <span className="total-label">Big Three Total</span>
                    <span className="total-value">
                        {totalDisplay}{' '}
                        <span style={{ fontSize: '0.9rem', fontWeight: 500, opacity: 0.6 }}>{unit}</span>
                    </span>
                </div>
            )}

            {showLogModal && (
                <div className="strength-modal-overlay" onClick={closeLogModal}>
                    <div className="strength-modal" onClick={(e) => e.stopPropagation()}>
                        <h3>{getLogModalTitle()}</h3>
                        <div style={{ textAlign: 'center', color: '#666', fontSize: '0.9rem' }}>
                            {EXERCISE_LABEL_LOOKUP[logLift] || logLift}
                        </div>

                        <div className="lift-input-group">
                            {isDeadHangLift(logLift, prMode) && (
                                <div className="dead-hang-modal-variant-group">
                                    <label style={{ fontSize: '0.8rem', color: '#666', fontWeight: 600 }}>Hand</label>
                                    <div className="dead-hang-variant-switch dead-hang-variant-switch-modal" role="tablist" aria-label="Dead hang hand selection">
                                        {DEAD_HANG_VARIANTS.map((variant) => (
                                            <button
                                                key={variant.key}
                                                type="button"
                                                className={`dead-hang-variant-btn ${logDeadHangVariant === variant.key ? 'active' : ''}`}
                                                onClick={() => setLogDeadHangVariant(variant.key)}
                                            >
                                                {variant.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                            <label style={{ fontSize: '0.8rem', color: '#666', fontWeight: 600 }}>Date</label>
                            <input
                                type="date"
                                className="lift-input"
                                style={{ fontSize: '1rem', padding: '0.5rem' }}
                                value={logDate}
                                onChange={(e) => setLogDate(e.target.value)}
                            />
                            <label style={{ fontSize: '0.8rem', color: '#666', fontWeight: 600, marginTop: '0.5rem' }}>
                                {getLogInputLabel()}
                            </label>
                            <input
                                type="number"
                                min="0"
                                step={prMode === 'weight' ? '0.1' : '1'}
                                className="lift-input"
                                value={logValue}
                                onChange={(e) => setLogValue(e.target.value)}
                                placeholder={getLogInputPlaceholder()}
                                autoFocus
                            />
                            {prMode === 'hold' && (
                                <div style={{ textAlign: 'center', color: '#888', fontSize: '0.8rem' }}>
                                    Displayed as m:ss in charts and history.
                                </div>
                            )}
                        </div>

                        <div className="strength-modal-actions">
                            <button className="strength-modal-btn cancel" onClick={closeLogModal}>Cancel</button>
                            <button className="strength-modal-btn save" onClick={handleLogSave}>Log Record</button>
                        </div>
                    </div>
                </div>
            )}

            {showHistoryModal && (
                <div className="strength-modal-overlay" onClick={() => setShowHistoryModal(false)}>
                    <div
                        className="strength-modal"
                        style={{ maxWidth: '760px', maxHeight: '80vh', overflowY: 'hidden', padding: '1.25rem 1.5rem', gap: '0.5rem' }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                            <h3 style={{ margin: 0 }}>PR History Log</h3>
                            <button onClick={() => setShowHistoryModal(false)} style={{ background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer' }}>✖</button>
                        </div>

                        <div className="history-filter-row history-filter-row-top">
                            <div className="history-filter-scroll">
                                {HISTORY_MODE_OPTIONS.map((mode) => (
                                    <button
                                        key={mode.key}
                                        onClick={() => setHistoryFilterMode(mode.key)}
                                        className="history-filter-pill"
                                        style={{
                                            border: historyFilterMode === mode.key ? 'none' : '1px solid #ddd',
                                            background: historyFilterMode === mode.key ? '#1f2333' : 'white',
                                            color: historyFilterMode === mode.key ? 'white' : '#666'
                                        }}
                                    >
                                        {mode.label}
                                    </button>
                                ))}
                            </div>
                            {shouldShowHistoryUnitToggle && (
                                <button
                                    onClick={() => setUnit(unit === 'kg' ? 'lb' : 'kg')}
                                    className="history-unit-toggle-btn"
                                >
                                    Unit: {unit.toUpperCase()}
                                </button>
                            )}
                        </div>

                        <div className="history-filter-row history-filter-row-exercises">
                            <div className="history-filter-scroll">
                            <button
                                onClick={() => setHistoryFilterLift('ALL')}
                                className="history-filter-pill"
                                style={{
                                    border: historyFilterLift === 'ALL' ? 'none' : '1px solid #ddd',
                                    background: historyFilterLift === 'ALL' ? '#395aff' : 'white',
                                    color: historyFilterLift === 'ALL' ? 'white' : '#666'
                                }}
                            >
                                All Exercises
                            </button>
                            {historyExerciseOptions.map((exercise) => (
                                <button
                                    key={exercise.key}
                                    onClick={() => setHistoryFilterLift(exercise.key)}
                                    className="history-filter-pill"
                                    style={{
                                        border: historyFilterLift === exercise.key ? 'none' : '1px solid #ddd',
                                        background: historyFilterLift === exercise.key ? '#395aff' : 'white',
                                        color: historyFilterLift === exercise.key ? 'white' : '#666'
                                    }}
                                >
                                    {exercise.label}
                                </button>
                            ))}
                            </div>
                        </div>

                        {shouldShowDeadHangVariantFilter && (
                            <div className="history-filter-row history-filter-row-variants">
                                <div className="history-filter-scroll">
                                    <button
                                        onClick={() => setHistoryDeadHangVariantFilter('ALL')}
                                        className="history-filter-pill"
                                        style={{
                                            border: historyDeadHangVariantFilter === 'ALL' ? 'none' : '1px solid #ddd',
                                            background: historyDeadHangVariantFilter === 'ALL' ? '#0f766e' : 'white',
                                            color: historyDeadHangVariantFilter === 'ALL' ? 'white' : '#666'
                                        }}
                                    >
                                        All Hands
                                    </button>
                                    {DEAD_HANG_VARIANTS.map((variant) => (
                                        <button
                                            key={variant.key}
                                            onClick={() => setHistoryDeadHangVariantFilter(variant.key)}
                                            className="history-filter-pill"
                                            style={{
                                                border: historyDeadHangVariantFilter === variant.key ? 'none' : '1px solid #ddd',
                                                background: historyDeadHangVariantFilter === variant.key ? '#0f766e' : 'white',
                                                color: historyDeadHangVariantFilter === variant.key ? 'white' : '#666'
                                            }}
                                        >
                                            {variant.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div style={{ overflowY: 'auto', flex: 1 }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                                <thead>
                                    <tr style={{ borderBottom: '2px solid #eee', textAlign: 'left', color: '#888' }}>
                                        <th style={{ padding: '0.5rem' }}>Date</th>
                                        <th style={{ padding: '0.5rem' }}>Mode</th>
                                        <th style={{ padding: '0.5rem' }}>Exercise</th>
                                        <th style={{ padding: '0.5rem' }}>Record</th>
                                        <th style={{ padding: '0.5rem', textAlign: 'right' }}>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredHistory.map((item) => (
                                        <tr key={item.id} style={{ borderBottom: '1px solid #f5f5f5' }}>
                                            <td style={{ padding: '0.8rem 0.5rem', color: '#555' }}>
                                                {item.formattedDate}
                                            </td>
                                            <td style={{ padding: '0.8rem 0.5rem', fontWeight: 600 }}>
                                                {MODE_LABEL_LOOKUP[item.prMode] || item.prMode}
                                            </td>
                                            <td style={{ padding: '0.8rem 0.5rem', fontWeight: 600 }}>
                                                <div className="strength-history-exercise-cell">
                                                    <span>{EXERCISE_LABEL_LOOKUP[item.lift] || item.lift}</span>
                                                    {isDeadHangLift(item.lift, item.prMode) && (
                                                        <span className="strength-history-variant-badge">
                                                            {getDeadHangVariantLabel(item.deadHangVariant)}
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td style={{ padding: '0.8rem 0.5rem', fontWeight: 700, color: '#395aff' }}>
                                                {formatHistoryRecord(item)}
                                            </td>
                                            <td style={{ padding: '0.8rem 0.5rem', textAlign: 'right' }}>
                                                <button
                                                    onClick={() => handleEditHistory(item)}
                                                    style={{ background: 'none', border: 'none', cursor: 'pointer', marginRight: '0.5rem', color: '#666' }}
                                                    title="Edit"
                                                >
                                                    ✏️
                                                </button>
                                                <button
                                                    onClick={() => setDeleteId(item.id)}
                                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444' }}
                                                    title="Delete"
                                                >
                                                    🗑️
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                    {filteredHistory.length === 0 && (
                                        <tr>
                                            <td colSpan="5" style={{ textAlign: 'center', padding: '2rem', color: '#aaa' }}>
                                                No history found.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {deleteId && (
                <div className="strength-modal-overlay" onClick={() => setDeleteId(null)}>
                    <div className="strength-modal" style={{ maxWidth: '300px', textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                        <h3 style={{ marginTop: 0 }}>Delete Record?</h3>
                        <p style={{ color: '#666', marginBottom: '1.5rem' }}>Are you sure you want to remove this PR entry?</p>
                        <div className="strength-modal-actions">
                            <button className="strength-modal-btn cancel" onClick={() => setDeleteId(null)}>Cancel</button>
                            <button className="strength-modal-btn save" style={{ background: '#ef4444' }} onClick={confirmDelete}>Delete</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default StrengthTracker;
