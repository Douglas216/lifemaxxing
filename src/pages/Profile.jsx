import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ADMIN_EMAILS } from '../constants';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { db } from '../firebase';

const DAYS_IN_WEEK = 7;
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DEFAULT_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const TIME_ZONE_OPTIONS = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Asia/Singapore',
  'Australia/Sydney',
];

const buildYearHeatmap = (counts, year) => {
  const startOfYear = new Date(year, 0, 1);
  const endOfYear = new Date(year, 11, 31);
  const firstMonday = new Date(startOfYear);
  while (firstMonday.getDay() !== 1) {
    firstMonday.setDate(firstMonday.getDate() - 1);
  }
  const lastSunday = new Date(endOfYear);
  while (lastSunday.getDay() !== 0) {
    lastSunday.setDate(lastSunday.getDate() + 1);
  }

  const weeks = [];
  let currentWeek = [];
  for (let cursor = new Date(firstMonday); cursor <= lastSunday; cursor.setDate(cursor.getDate() + 1)) {
    const dayClone = new Date(cursor);
    const key = dayClone.toISOString().slice(0, 10);
    currentWeek.push({
      date: dayClone,
      key,
      count: dayClone.getFullYear() === year ? counts[key] || 0 : 0,
    });

    if (currentWeek.length === DAYS_IN_WEEK) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
  }
  return weeks;
};

const Profile = () => {
  const { user } = useAuth();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [gender, setGender] = useState('male');
  const [dob, setDob] = useState('');
  const [dateJoined, setDateJoined] = useState(null);
  const [timeZone, setTimeZone] = useState(DEFAULT_TIME_ZONE);
  const [heatmapYear] = useState(2025);
  const [heatmapData, setHeatmapData] = useState([]);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  /* Robust authorization check */
  const isAuthorized = useMemo(() => {
    if (!user || !user.email) return false;
    // Hardcode fallback just in case constant is empty
    const normalizedEmail = user.email.toLowerCase().trim();
    return ADMIN_EMAILS.some(e => e.toLowerCase().trim() === normalizedEmail) || normalizedEmail === 'douglasj216@outlook.com';
  }, [user]);

  const profileDocRef = useMemo(() => {
    if (!user) {
      return null;
    }
    return doc(db, 'users', user.uid, 'profile', 'details');
  }, [user]);

  const loadProfile = useCallback(async () => {
    if (!profileDocRef) {
      return;
    }
    try {
      const snap = await getDoc(profileDocRef);
      if (!snap.exists()) {
        return;
      }
      const data = snap.data();
      setFirstName(data.firstName ?? '');
      setLastName(data.lastName ?? '');
      setGender(data.gender ?? 'male');
      setDob(data.dob ?? '');
      setTimeZone(data.timeZone ?? DEFAULT_TIME_ZONE);
      setDateJoined(data.dateJoined?.toDate ? data.dateJoined.toDate() : data.dateJoined ?? null);
    } catch (error) {
      console.warn('Failed to load profile', error);
    }
  }, [profileDocRef]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    const fetchHeatmap = async () => {
      if (!user) {
        setHeatmapData([]);
        return;
      }
      try {
        const counts = {};
        const start = new Date(heatmapYear, 0, 1);
        const end = new Date(heatmapYear, 11, 31);
        const startKey = start.getTime();
        const endKey = end.getTime();

        // Use sessionHistory for permanent record
        const historyRef = collection(db, 'users', user.uid, 'sessionHistory');
        let snap = await getDocs(historyRef);

        // Migration: If history is empty, check mainSessions and backfill
        if (snap.empty) {
          const mainSessionsRef = collection(db, 'users', user.uid, 'mainSessions');
          const mainSnap = await getDocs(mainSessionsRef);

          if (!mainSnap.empty) {
            // Perform migration
            const migrationPromises = mainSnap.docs.map(docSnap => {
              const data = docSnap.data();
              return setDoc(doc(historyRef, docSnap.id), {
                ...data,
                savedAt: serverTimestamp(),
                source: 'migration'
              });
            });
            await Promise.all(migrationPromises);
            // Re-fetch after migration
            snap = await getDocs(historyRef);
          }
        }

        snap.forEach((docSnap) => {
          const data = docSnap.data();
          const startTimestamp = data.startTimestamp?.toDate ? data.startTimestamp.toDate() : data.startTimestamp;
          if (!startTimestamp) {
            return;
          }
          const time = startTimestamp.getTime();
          if (time < startKey || time > endKey) {
            return;
          }
          const key = startTimestamp.toISOString().slice(0, 10);
          counts[key] = (counts[key] || 0) + 1;
        });
        setHeatmapData(buildYearHeatmap(counts, heatmapYear));
      } catch (error) {
        console.warn('Failed to compute heatmap', error);
        setHeatmapData([]);
      }
    };
    fetchHeatmap();
  }, [user, heatmapYear]);

  const orderedWeeks = useMemo(() => heatmapData, [heatmapData]);

  const monthLabelsByWeek = useMemo(
    () =>
      orderedWeeks.map((week, index) => {
        const firstDayOfMonth = week.find(
          (day) => day.date && day.date.getDate() === 1 && day.date.getFullYear() === heatmapYear
        );
        if (!firstDayOfMonth) {
          return { label: '', key: `month-${index}` };
        }
        return {
          label: MONTH_LABELS[firstDayOfMonth.date.getMonth()],
          key: `month-${firstDayOfMonth.key}`,
        };
      }),
    [orderedWeeks, heatmapYear]
  );

  const handleSave = async (event) => {
    event.preventDefault();
    if (!profileDocRef || !user) {
      return;
    }
    setSaving(true);
    try {
      await setDoc(
        profileDocRef,
        {
          firstName,
          lastName,
          gender,
          dob,
          timeZone,
          dateJoined: dateJoined ?? serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      setToast('Profile updated!');
      setTimeout(() => setToast(''), 3000);
    } catch (error) {
      console.warn('Failed to save profile', error);
    } finally {
      setSaving(false);
    }
  };

  const levelClass = (count) => {
    if (!count) {
      return 'profile-heatmap__day--level0';
    }
    if (count >= 10) {
      return 'profile-heatmap__day--level4';
    }
    if (count >= 6) {
      return 'profile-heatmap__day--level3';
    }
    if (count >= 3) {
      return 'profile-heatmap__day--level2';
    }
    return 'profile-heatmap__day--level1';
  };

  if (!user) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="profile-page profile-page--full" style={{ position: 'relative' }}>
      <section className="profile-header">
        <h1>Profile</h1>
        {dateJoined && (
          <p className="profile-date-joined">
            Officially Locked in since{' '}
            {new Date(dateJoined).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })}
            <br />
            <small style={{ marginTop: '5px', display: 'block', opacity: 0.6 }}>
              User: {user?.email}
            </small>
          </p>
        )}
      </section>

      <section className="profile-info">
        <form className="profile-form profile-form--wide" onSubmit={handleSave}>
          <div className="profile-form__group">
            <label>
              First Name
              <input type="text" value={firstName} onChange={(event) => setFirstName(event.target.value)} />
            </label>
            <label>
              Last Name
              <input type="text" value={lastName} onChange={(event) => setLastName(event.target.value)} />
            </label>
          </div>
          <div className="profile-form__group">
            <label>
              Gender
              <select value={gender} onChange={(event) => setGender(event.target.value)}>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="non-binary">Non-Binary</option>
              </select>
            </label>
            <label>
              Date of Birth
              <input type="date" value={dob} onChange={(event) => setDob(event.target.value)} />
            </label>
            <label>
              Time Zone
              <select value={timeZone} onChange={(event) => setTimeZone(event.target.value)}>
                {TIME_ZONE_OPTIONS.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button type="submit" className="profile-save" disabled={saving}>
            {saving ? 'Saving...' : 'Save Profile'}
          </button>
        </form>
        {toast && <div className="profile-toast">{toast}</div>}
      </section>

      <section className="profile-heatmap-wrapper">
        <div className="profile-heatmap__title">Focus Heatmap — {heatmapYear}</div>
        <div className="profile-heatmap">
          <div className="profile-heatmap__months-row">
            <span className="profile-heatmap__month-spacer" />
            <div className="profile-heatmap__months">
              {monthLabelsByWeek.map(({ label, key }) => (
                <span
                  key={key}
                  className={`profile-heatmap__month-label${label ? ' profile-heatmap__month-label--visible' : ''}`}
                >
                  {label}
                </span>
              ))}
            </div>
          </div>
          <div className="profile-heatmap__body">
            <div className="profile-heatmap__day-labels">
              {DAY_LABELS.map((label) => (
                <span key={label}>{label}</span>
              ))}
            </div>
            <div className="profile-heatmap__weeks">
              {orderedWeeks.map((week, index) => (
                <div className="profile-heatmap__week" key={`week-${index}`}>
                  {week.map((day) => (
                    <span
                      key={day.key}
                      className={`profile-heatmap__day ${levelClass(day.count)}`}
                      title={day.date ? `${day.key}: ${day.count || 0} session${day.count === 1 ? '' : 's'}` : ''}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="profile-heatmap__legend">
          <span>Less</span>
          <span className="profile-heatmap__legend-box profile-heatmap__day--level0" />
          <span className="profile-heatmap__legend-box profile-heatmap__day--level2" />
          <span className="profile-heatmap__legend-box profile-heatmap__day--level4" />
          <span>More</span>
        </div>
      </section>

      {isAuthorized && (
        <div style={{
          marginTop: '3rem',
          paddingBottom: '3rem',
          display: 'flex',
          justifyContent: 'flex-end',
          maxWidth: '1000px',
          width: '100%',
          margin: '3rem auto 0'
        }}>
          <NavLink
            to="/nancy"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              background: '#fff0f5',
              color: '#db2777',
              padding: '0.8rem 2.5rem',
              borderRadius: '9999px',
              textDecoration: 'none',
              fontWeight: '700',
              fontSize: '1.1rem',
              border: '2px solid #fecdd3',
              boxShadow: '0 4px 15px rgba(236, 72, 153, 0.15)',
              transition: 'all 0.2s ease',
            }}
            onMouseOver={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
            onMouseOut={(e) => e.currentTarget.style.transform = 'scale(1)'}
          >
            ♡ nancy & doug ♡
          </NavLink>
        </div>
      )}
    </div>
  );
};

export default Profile;
