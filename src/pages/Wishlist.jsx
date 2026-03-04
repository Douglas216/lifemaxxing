import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import {
  addDoc,
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  deleteDoc,
} from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { db } from '../firebase';
import completionSound from '../assets/main-timer-completion.mp3';
import addTaskSound from '../assets/task-added.mp3';
import './Wishlist.css';

const DEFAULT_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

const formatDateKey = (date, timeZone) => {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  }
};

const formatDisplayDate = (key, timeZone) => {
  const [year, month, day] = key.split('-').map(Number);
  // Create a date object treating the input as local time components
  // This avoids UTC conversion issues that cause off-by-one errors
  const date = new Date(year, month - 1, day);
  return new Intl.DateTimeFormat([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
};

const createId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;

const QUADRANTS = [
  { value: 'urgent-important', label: 'Urgent + Important' },
  { value: 'not-urgent-important', label: 'Not Urgent + Important' },
  { value: 'urgent-not-important', label: 'Urgent + Not Important' },
  { value: 'not-urgent-not-important', label: 'Not Urgent + Not Important' },
];

const QUADRANT_LABELS = QUADRANTS.reduce((acc, quadrant) => {
  acc[quadrant.value] = quadrant.label;
  return acc;
}, {});

const QUADRANT_SORT_ORDER = [
  'urgent-important',
  'not-urgent-important',
  'urgent-not-important',
  'not-urgent-not-important',
];

const Wishlist = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [directions, setDirections] = useState([]);
  const [newDirection, setNewDirection] = useState('');
  const [addingDirection, setAddingDirection] = useState(false);
  const [directionError, setDirectionError] = useState('');
  const [isEditMode, setIsEditMode] = useState(false);

  const [tasks, setTasks] = useState([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [tasksError, setTasksError] = useState('');
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [taskQuadrant, setTaskQuadrant] = useState('');
  const [taskEstimateMinutes, setTaskEstimateMinutes] = useState('');
  const [taskDraft, setTaskDraft] = useState('');
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState('');
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [timeZone, setTimeZone] = useState(DEFAULT_TIME_ZONE);
  const [taskSortBy, setTaskSortBy] = useState('time');
  const [taskSortDir, setTaskSortDir] = useState('desc');
  const [selectedHistoryEntry, setSelectedHistoryEntry] = useState(null);

  const todayKey = useMemo(() => formatDateKey(new Date(), timeZone), [timeZone]);

  const directionsCollectionRef = useMemo(() => {
    if (!user) {
      return null;
    }
    return collection(db, 'users', user.uid, 'lifeDirections');
  }, [user]);

  const todayTaskDocRef = useMemo(() => {
    if (!user) {
      return null;
    }
    return doc(db, 'users', user.uid, 'dailyTasks', todayKey);
  }, [user, todayKey]);

  const tasksCollectionRef = useMemo(() => {
    if (!user) {
      return null;
    }
    return collection(db, 'users', user.uid, 'dailyTasks');
  }, [user]);

  const profileDocRef = useMemo(() => {
    if (!user) {
      return null;
    }
    return doc(db, 'users', user.uid, 'profile', 'details');
  }, [user]);

  const persistTasks = useCallback(
    async (nextTasks) => {
      if (!todayTaskDocRef) {
        return;
      }
      try {
        await setDoc(
          todayTaskDocRef,
          {
            tasks: nextTasks,
            date: todayKey,
            timeZone,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      } catch (error) {
        console.warn('Failed to save tasks', error);
        setTasksError('Failed to save tasks. Try again.');
      }
    },
    [todayKey, timeZone, todayTaskDocRef]
  );

  useEffect(() => {
    if (!profileDocRef) {
      setTimeZone(DEFAULT_TIME_ZONE);
      return undefined;
    }
    const unsub = onSnapshot(
      profileDocRef,
      (snapshot) => {
        const data = snapshot.data();
        setTimeZone(data?.timeZone || DEFAULT_TIME_ZONE);
      },
      (error) => {
        console.warn('Failed to load profile for timezone', error);
        setTimeZone(DEFAULT_TIME_ZONE);
      }
    );
    return () => unsub();
  }, [profileDocRef]);

  useEffect(() => {
    if (!directionsCollectionRef) {
      setDirections([]);
      return undefined;
    }
    const q = query(directionsCollectionRef, orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const list = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          text: docSnap.data().text,
          createdAt: docSnap.data().createdAt?.toDate?.() ?? null,
        }));
        setDirections(list);
      },
      (error) => {
        console.warn('Failed to load life directions', error);
        setDirections([]);
        setDirectionError('Unable to load your life directions.');
      }
    );
    return () => unsub();
  }, [directionsCollectionRef]);

  useEffect(() => {
    if (!todayTaskDocRef) {
      setTasks([]);
      return undefined;
    }
    setTasksLoading(true);
    const unsub = onSnapshot(
      todayTaskDocRef,
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          setTasks(data.tasks || []);
        } else {
          setTasks([]);
        }
        setTasksLoading(false);
        setTasksError('');
      },
      (error) => {
        console.warn('Failed to load tasks', error);
        setTasks([]);
        setTasksLoading(false);
        setTasksError('Unable to load today’s tasks.');
      }
    );
    return () => unsub();
  }, [todayTaskDocRef]);

  useEffect(() => {
    if (!tasksCollectionRef) {
      setHistory([]);
      return undefined;
    }
    setHistoryLoading(true);
    // If showing all, fetch more (e.g. 50). If not, fetch enough to ensure we get 5 after filtering today (e.g. 7).
    const limitCount = showAllHistory ? 50 : 7;
    const q = query(tasksCollectionRef, orderBy('date', 'desc'), limit(limitCount));
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const entries = snapshot.docs
          .map((docSnap) => {
            const data = docSnap.data();
            const dateValue = data.date || docSnap.id;
            const taskList = Array.isArray(data.tasks) ? data.tasks : [];
            const hasTasks = taskList.length > 0;
            const completedCount = taskList.filter((task) => task.completed).length;
            const totalCount = taskList.length;
            const percent = hasTasks
              ? Math.round((completedCount / totalCount) * 100)
              : 0;
            return {
              id: docSnap.id,
              date: dateValue,
              tasks: taskList,
              percent,
              completedCount,
              totalCount,
              hasTasks,
              timeZone: data.timeZone || DEFAULT_TIME_ZONE,
            };
          })
          .filter((entry) => entry.date !== todayKey);

        // If not showing all, enforce the limit of 5 explicitly
        setHistory(showAllHistory ? entries : entries.slice(0, 5));
        setHistoryLoading(false);
        setHistoryError('');
      },
      (error) => {
        console.warn('Failed to load history', error);
        setHistory([]);
        setHistoryLoading(false);
        setHistoryError('Unable to load completion history.');
      }
    );
    return () => unsub();
  }, [tasksCollectionRef, todayKey, showAllHistory]);

  const handleAddDirection = async (event) => {
    event.preventDefault();
    if (!directionsCollectionRef || !newDirection.trim()) {
      return;
    }
    setAddingDirection(true);
    setDirectionError('');
    try {
      await addDoc(directionsCollectionRef, {
        text: newDirection.trim(),
        createdAt: serverTimestamp(),
      });
      setNewDirection('');
    } catch (error) {
      console.warn('Failed to add life direction', error);
      setDirectionError('Could not add life direction.');
    } finally {
      setAddingDirection(false);
    }
  };

  const handleRemoveDirection = async (directionId) => {
    if (!directionsCollectionRef || !directionId) {
      return;
    }
    try {
      await deleteDoc(doc(directionsCollectionRef, directionId));
    } catch (error) {
      console.warn('Failed to delete life direction', error);
      setDirectionError('Could not delete life direction.');
    }
  };

  const handleAddTask = async ({ text, quadrant, estimateMinutes }) => {
    if (!text.trim()) {
      return;
    }
    const nextTasks = [
      ...tasks,
      {
        id: createId(),
        text: text.trim(),
        quadrant,
        estimateMinutes,
        completed: false,
        createdAt: new Date().toISOString(),
      },
    ];
    setTasks(nextTasks);
    persistTasks(nextTasks);

    try {
      new Audio(addTaskSound).play();
    } catch (error) {
      console.error('Error playing add task sound:', error);
    }
  };

  const handleUpdateTask = async ({ id, text, quadrant, estimateMinutes }) => {
    if (!text.trim() || !id) {
      return;
    }
    const nextTasks = tasks.map((task) =>
      task.id === id
        ? {
          ...task,
          text: text.trim(),
          quadrant,
          estimateMinutes,
        }
        : task
    );
    setTasks(nextTasks);
    persistTasks(nextTasks);
  };

  const handleSubmitTaskModal = (event) => {
    event.preventDefault();
    const trimmed = taskDraft.trim();
    const minutes = Number(taskEstimateMinutes);
    if (!trimmed || !taskQuadrant || !Number.isFinite(minutes) || minutes <= 0) {
      return;
    }
    if (editingTaskId) {
      handleUpdateTask({ id: editingTaskId, text: trimmed, quadrant: taskQuadrant, estimateMinutes: minutes });
    } else {
      handleAddTask({ text: trimmed, quadrant: taskQuadrant, estimateMinutes: minutes });
    }
    setTaskDraft('');
    setTaskQuadrant('');
    setTaskEstimateMinutes('');
    setEditingTaskId(null);
    setShowTaskModal(false);
  };

  const openTaskModal = ({ task } = {}) => {
    if (task) {
      setEditingTaskId(task.id);
      setTaskDraft(task.text || '');
      setTaskQuadrant(task.quadrant || '');
      setTaskEstimateMinutes(
        Number.isFinite(task.estimateMinutes) ? String(task.estimateMinutes) : ''
      );
    } else {
      setEditingTaskId(null);
      setTaskDraft('');
      setTaskQuadrant('');
      setTaskEstimateMinutes('');
    }
    setShowTaskModal(true);
  };

  const handleOpenHistoryTasks = (entry) => {
    setSelectedHistoryEntry(entry);
  };

  // Rollover Logic
  useEffect(() => {
    if (!user || !tasksCollectionRef || !todayTaskDocRef) return;

    const checkAndPerformRollover = async () => {
      try {
        // Check if today's document already exists
        const todayDocSnap = await import('firebase/firestore').then(mod => mod.getDoc(todayTaskDocRef));

        if (todayDocSnap.exists()) {
          return; // Today already started
        }

        // Find the most recent previous day
        const q = query(tasksCollectionRef, orderBy('date', 'desc'), limit(1));
        const querySnapshot = await import('firebase/firestore').then(mod => mod.getDocs(q));

        if (!querySnapshot.empty) {
          const lastDoc = querySnapshot.docs[0];
          const lastDate = lastDoc.data().date;

          // Ensure we aren't looking at today (though if today didn't exist, this should be past)
          if (lastDate !== todayKey) {
            const lastTasks = lastDoc.data().tasks || [];
            const incompleteTasks = lastTasks.filter(t => !t.completed);

            if (incompleteTasks.length > 0) {
              // Carry them over!
              // If they don't have a createdAt, assign the lastDate as a fallback
              const carriedOverTasks = incompleteTasks.map(t => ({
                ...t,
                createdAt: t.createdAt || new Date(lastDate).toISOString()
              }));

              await setDoc(todayTaskDocRef, {
                tasks: carriedOverTasks,
                date: todayKey,
                timeZone,
                updatedAt: serverTimestamp(),
              });
              // We don't need to manually set state here, the snapshot listener will pick it up
            }
          }
        }
      } catch (error) {
        console.warn("Error performing task rollover:", error);
      }
    };

    checkAndPerformRollover();
  }, [user, tasksCollectionRef, todayTaskDocRef, todayKey, timeZone]);

  const getTaskAge = (createdAt) => {
    if (!createdAt) return 0;
    const created = new Date(createdAt);
    const now = new Date();
    // Reset times to midnight for accurate day difference
    created.setHours(0, 0, 0, 0);
    now.setHours(0, 0, 0, 0);
    const diffTime = Math.abs(now - created);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  const handleToggleTask = async (taskId) => {
    const nextTasks = tasks.map((task) => {
      if (task.id === taskId) {
        const isNowCompleted = !task.completed;
        if (isNowCompleted) {
          try {
            new Audio(completionSound).play();
          } catch (error) {
            console.error('Error playing completion sound:', error);
          }
        }
        return { ...task, completed: isNowCompleted };
      }
      return task;
    });
    setTasks(nextTasks);
    persistTasks(nextTasks);
  };

  const handleRemoveTask = async (taskId) => {
    const nextTasks = tasks.filter((task) => task.id !== taskId);
    setTasks(nextTasks);
    persistTasks(nextTasks);
  };

  const completionPercent = useMemo(() => {
    if (tasks.length === 0) {
      return 0;
    }
    const completed = tasks.filter((task) => task.completed).length;
    return Math.round((completed / tasks.length) * 100);
  }, [tasks]);

  const sortedTasks = useMemo(() => {
    const list = [...tasks];
    if (taskSortBy === 'time') {
      list.sort((a, b) => {
        const aVal = Number.isFinite(a.estimateMinutes) ? a.estimateMinutes : 0;
        const bVal = Number.isFinite(b.estimateMinutes) ? b.estimateMinutes : 0;
        return taskSortDir === 'asc' ? aVal - bVal : bVal - aVal;
      });
      return list;
    }
    if (taskSortBy === 'completion') {
      list.sort((a, b) => {
        const aVal = a.completed ? 1 : 0;
        const bVal = b.completed ? 1 : 0;
        if (aVal !== bVal) {
          return taskSortDir === 'asc' ? aVal - bVal : bVal - aVal;
        }
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bTime - aTime;
      });
      return list;
    }
    const orderMap = QUADRANT_SORT_ORDER.reduce((acc, key, index) => {
      acc[key] = index;
      return acc;
    }, {});
    list.sort((a, b) => {
      const aVal = orderMap[a.quadrant] ?? 999;
      const bVal = orderMap[b.quadrant] ?? 999;
      return taskSortDir === 'asc' ? aVal - bVal : bVal - aVal;
    });
    return list;
  }, [tasks, taskSortBy, taskSortDir]);

  const circleRadius = 70;
  const circumference = 2 * Math.PI * circleRadius;
  const progressOffset = circumference - (completionPercent / 100) * circumference;

  if (!user) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="wishlist-page">
      <section className="wishlist-section wishlist-section--directions">
        <header style={{ position: 'relative', width: '100%', marginBottom: '1.5rem', textAlign: 'center' }}>
          <h1>Life Direction Keywords</h1>
          <p style={{ margin: '0.5rem auto 0' }}>Capture the phrases that keep you grounded. They become part of your history.</p>
          <button
            onClick={() => navigate('/life-advice')}
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              background: 'transparent',
              border: '1px solid #e5e7eb',
              padding: '0.4rem 0.8rem',
              borderRadius: '999px',
              color: '#6b7280',
              fontSize: '0.85rem',
              cursor: 'pointer',
              transition: 'all 0.2s',
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem'
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.borderColor = '#1f2333';
              e.currentTarget.style.color = '#1f2333';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.borderColor = '#e5e7eb';
              e.currentTarget.style.color = '#6b7280';
            }}
          >
            <span>📜</span> Elder's Wisdom
          </button>
        </header>
        <form className="wishlist-direction-form" onSubmit={handleAddDirection}>
          <input
            type="text"
            placeholder="Add a guiding phrase..."
            value={newDirection}
            onChange={(event) => setNewDirection(event.target.value)}
          />
          <button type="submit" disabled={addingDirection}>
            {addingDirection ? 'Adding...' : 'Add'}
          </button>
          <button
            type="button"
            className={`wishlist-edit-toggle ${isEditMode ? 'active' : ''}`}
            onClick={() => setIsEditMode(!isEditMode)}
          >
            {isEditMode ? 'Done' : 'Edit'}
          </button>
        </form>
        {directionError && <div className="wishlist-error">{directionError}</div>}
        <div className="wishlist-direction-history">
          {directions.length === 0 ? (
            <p className="wishlist-empty">No life directions yet.</p>
          ) : (
            directions.map((direction) => (
              <div className="wishlist-direction-chip" key={direction.id}>
                <div className="wishlist-direction-content">
                  <span>{direction.text}</span>
                  {direction.createdAt && (
                    <small>
                      Added{' '}
                      {direction.createdAt.toLocaleDateString([], {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </small>
                  )}
                </div>
                {isEditMode && (
                  <button
                    className="wishlist-direction-remove"
                    onClick={() => handleRemoveDirection(direction.id)}
                    title="Remove direction"
                  >
                    ×
                  </button>
                )}
              </div>
            ))
          )}
        </div>


      </section>

      <section className="wishlist-section wishlist-section--tasks">
        <div className="wishlist-tasks-panel">
          <header className="wishlist-tasks-header">
            <div className="wishlist-tasks-header-row">
              <h2>Today’s Tasks</h2>
              <div className="wishlist-task-sort">
                <button
                  type="button"
                  className={`wishlist-sort-pill ${taskSortBy === 'time' ? 'active' : ''}`}
                  onClick={() => setTaskSortBy('time')}
                >
                  Time
                </button>
                <button
                  type="button"
                  className={`wishlist-sort-pill ${taskSortBy === 'category' ? 'active' : ''}`}
                  onClick={() => setTaskSortBy('category')}
                >
                  Category
                </button>
                <button
                  type="button"
                  className={`wishlist-sort-pill ${taskSortBy === 'completion' ? 'active' : ''}`}
                  onClick={() => setTaskSortBy('completion')}
                >
                  Completion
                </button>
                <button
                  type="button"
                  className="wishlist-sort-direction"
                  onClick={() => setTaskSortDir(taskSortDir === 'asc' ? 'desc' : 'asc')}
                  title={taskSortDir === 'asc' ? 'Ascending' : 'Descending'}
                >
                  {taskSortDir === 'asc' ? '↑' : '↓'}
                </button>
              </div>
            </div>
            <p>Plan concrete actions for {todayKey} and mark them as you go.</p>
          </header>
          <div className="wishlist-task-form">
            <button
              type="button"
              className="wishlist-task-modal-trigger"
              onClick={() => openTaskModal()}
            >
              Add Task
            </button>
          </div>
          {tasksError && <div className="wishlist-error">{tasksError}</div>}
          {tasksLoading ? (
            <div className="wishlist-loading">Loading tasks…</div>
          ) : (
            <ul className="wishlist-task-list">
              {sortedTasks.length === 0 ? (
                <li className="wishlist-empty">No tasks set for today.</li>
              ) : (
                sortedTasks.map((task) => {
                  const daysOld = getTaskAge(task.createdAt);
                  const isStale = !task.completed && daysOld > 0;
                  const quadrantLabel = QUADRANT_LABELS[task.quadrant] || task.quadrant;
                  const quadrantClass = QUADRANT_LABELS[task.quadrant] ? task.quadrant : '';

                  return (
                    <li
                      key={task.id}
                      className={`${task.completed ? 'completed' : ''} ${isStale ? 'wishlist-task-item--stale' : ''}`}
                    >
                      <label>
                        <input
                          type="checkbox"
                          checked={task.completed}
                          onChange={() => handleToggleTask(task.id)}
                        />
                        <div className="wishlist-task-content">
                          <span>{task.text}</span>
                          {task.estimateMinutes ? (
                            <span className="wishlist-task-estimate">{task.estimateMinutes} min</span>
                          ) : null}
                          {isStale && (
                            <span className="wishlist-task-age">
                              {daysOld} day{daysOld > 1 ? 's' : ''} old
                            </span>
                          )}
                        </div>
                      </label>
                      {task.quadrant && (
                        <span className={`wishlist-task-quadrant-label${quadrantClass ? ` ${quadrantClass}` : ''}`}>
                          {quadrantLabel}
                        </span>
                      )}
                      <div className="wishlist-task-actions">
                        <span className="wishlist-task-status">
                          {task.completed ? 'Completed' : 'Pending'}
                        </span>
                        <button
                          className="wishlist-task-edit"
                          onClick={() => openTaskModal({ task })}
                          title="Edit task"
                        >
                          Edit
                        </button>
                        <button
                          className="wishlist-task-remove"
                          onClick={() => handleRemoveTask(task.id)}
                          title="Remove task"
                        >
                          ×
                        </button>
                      </div>
                    </li>
                  );
                })
              )}
            </ul>
          )}
        </div>
        <div className="wishlist-progress-panel">
          <h3>Daily Completion</h3>
          <p>{completionPercent}% of tasks completed today.</p>
          <div className="wishlist-progress-chart">
            <svg width="180" height="180">
              <circle
                className="wishlist-progress-track"
                cx="90"
                cy="90"
                r={circleRadius}
                strokeWidth="14"
              />
              <circle
                className="wishlist-progress-indicator"
                cx="90"
                cy="90"
                r={circleRadius}
                strokeWidth="14"
                strokeDasharray={circumference}
                strokeDashoffset={progressOffset}
              />
              <text x="90" y="95" textAnchor="middle" className="wishlist-progress-text">
                {completionPercent}%
              </text>
            </svg>
          </div>
          <small>Resets every day at 23:59.</small>
        </div>
      </section>

      <section className="wishlist-section wishlist-section--history">
        <header>
          <h2>Daily Tasks Completion History</h2>
          <p>Track how consistently you execute on your intentions.</p>
        </header>
        {historyError && <div className="wishlist-error">{historyError}</div>}
        {historyLoading ? (
          <div className="wishlist-loading">Loading history…</div>
        ) : history.length === 0 ? (
          <p className="wishlist-empty">No history recorded yet.</p>
        ) : (
          <>
            <ul className="wishlist-history-list">
              {history.map((entry) => {
                const formattedDate = entry.date
                  ? formatDisplayDate(entry.date, entry.timeZone)
                  : entry.id;
                return (
                  <li
                    key={entry.id}
                    className={`wishlist-history-item${entry.hasTasks ? '' : ' wishlist-history-item--empty'}`}
                    onClick={() => handleOpenHistoryTasks(entry)}
                  >
                    <div className="wishlist-history-date">{formattedDate}</div>
                    <div className="wishlist-history-progress">
                      <div className="wishlist-history-progress__track">
                        <div
                          className={`wishlist-history-progress__fill${entry.hasTasks ? '' : ' wishlist-history-progress__fill--empty'
                            }`}
                          style={{ width: entry.hasTasks ? `${entry.percent}%` : '100%' }}
                        />
                      </div>
                      <span className="wishlist-history-label">
                        {entry.hasTasks
                          ? `${entry.percent}% completed (${entry.completedCount}/${entry.totalCount})`
                          : 'No tasks added'}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
            <button
              className="wishlist-history-toggle"
              onClick={() => setShowAllHistory(!showAllHistory)}
            >
              {showAllHistory ? 'Show Recent Only' : 'Show All History'}
            </button>
          </>
        )}
      </section>

      {showTaskModal && (
        <div className="wishlist-modal-overlay" onClick={() => setShowTaskModal(false)}>
          <div className="wishlist-modal" onClick={(e) => e.stopPropagation()}>
            <header className="wishlist-modal-header">
              <h3>{editingTaskId ? 'Edit Task' : 'Add Task'}</h3>
            </header>
            <form className="wishlist-modal-body" onSubmit={handleSubmitTaskModal}>
              <label className="wishlist-modal-label">Task description</label>
              <textarea
                className="wishlist-modal-textarea"
                placeholder="What do you want to accomplish?"
                value={taskDraft}
                onChange={(event) => setTaskDraft(event.target.value)}
                rows={3}
                autoFocus
              />

              <label className="wishlist-modal-label">Urgency & Importance</label>
              <div className="wishlist-quadrant-grid">
                {QUADRANTS.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    className={`wishlist-quadrant-tile ${item.value}${taskQuadrant === item.value ? ' active' : ''}`}
                    onClick={() => setTaskQuadrant(item.value)}
                  >
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>

              <label className="wishlist-modal-label">Estimated time (minutes)</label>
              <input
                type="number"
                min="1"
                step="1"
                className="wishlist-modal-input"
                placeholder="e.g. 30"
                value={taskEstimateMinutes}
                onChange={(event) => setTaskEstimateMinutes(event.target.value)}
              />

              <div className="wishlist-modal-actions">
                <button
                  type="button"
                  className="wishlist-modal-cancel"
                  onClick={() => {
                    setShowTaskModal(false);
                    setEditingTaskId(null);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="wishlist-modal-submit"
                  disabled={!taskDraft.trim() || !taskQuadrant || !taskEstimateMinutes}
                >
                  {editingTaskId ? 'Save Changes' : 'Add Task'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {selectedHistoryEntry && (
        <div className="wishlist-modal-overlay" onClick={() => setSelectedHistoryEntry(null)}>
          <div className="wishlist-modal wishlist-history-modal" onClick={(e) => e.stopPropagation()}>
            <header className="wishlist-modal-header">
              <h3>
                Tasks completed on{' '}
                {formatDisplayDate(
                  selectedHistoryEntry.date || selectedHistoryEntry.id,
                  selectedHistoryEntry.timeZone || DEFAULT_TIME_ZONE
                )}
              </h3>
            </header>
            <div className="wishlist-history-modal-body">
              {(selectedHistoryEntry.tasks || []).filter((task) => task.completed).length ? (
                <ul className="wishlist-history-task-list">
                  {(selectedHistoryEntry.tasks || []).filter((task) => task.completed).map((task) => {
                    const quadrantLabel = QUADRANT_LABELS[task.quadrant] || task.quadrant;
                    const quadrantClass = QUADRANT_LABELS[task.quadrant] ? task.quadrant : '';
                    return (
                      <li
                        key={task.id || `${task.text}-${task.createdAt || ''}`}
                        className={`wishlist-history-task-item${task.completed ? ' completed' : ''}`}
                      >
                        <span className="wishlist-history-task-check">{task.completed ? 'Done' : 'Pending'}</span>
                        <span className="wishlist-history-task-text">{task.text}</span>
                        {task.quadrant && (
                          <span className={`wishlist-task-quadrant-label${quadrantClass ? ` ${quadrantClass}` : ''}`}>
                            {quadrantLabel}
                          </span>
                        )}
                        {task.estimateMinutes ? (
                          <span className="wishlist-task-estimate">{task.estimateMinutes} min</span>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="wishlist-empty">No completed tasks for that day.</p>
              )}
              <div className="wishlist-modal-actions">
                <button
                  type="button"
                  className="wishlist-modal-submit"
                  onClick={() => setSelectedHistoryEntry(null)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Wishlist;
