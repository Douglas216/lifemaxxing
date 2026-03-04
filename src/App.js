import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import StudyRoom from './components/StudyRoom';
import TimerPage from './components/TimerPage';
import RsipPage from './pages/RsipPage';
import CorePrinciples from './pages/CorePrinciples';
import AuthTest from './pages/AuthTest';
import Signup from './pages/Signup.jsx';
import Login from './pages/Login.jsx';
import Profile from './pages/Profile.jsx';
import FocusRecord from './pages/FocusRecord.jsx';
import Wishlist from './pages/Wishlist.jsx';
import LifeAdvice from './pages/LifeAdvice.jsx';
import MyTemple from './pages/MyTemple.jsx';
import PrivatePage from './pages/PrivatePage.jsx';
import Timeline from './pages/nancy/Timeline';
import Photos from './pages/nancy/Photos';
import Map from './pages/nancy/Map';
import BucketList from './pages/nancy/BucketList';
import CreativeMoments from './pages/nancy/CreativeMoments';
import NancyDictionary from './pages/nancy/Dictionary';
import NancyLayout from './pages/nancy/NancyLayout';
import './App.css';
import './firebase';
import {
  SACRED_INTENT_STORAGE_KEY,
  MAIN_CHAIN_DURATION_KEY,
  AUX_CHAIN_DURATION_KEY,
  MAIN_CHAIN_SESSION_KEY,
  AUX_CHAIN_SESSION_KEY,
} from './constants';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>

          <Route path="/" element={<StudyRoom />} />

          {/* ⭐ Signup Route */}
          <Route path="/signup" element={<Signup />} />

          {/* ⭐ Login Route */}
          <Route path="/login" element={<Login />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/wishlist" element={<Wishlist />} />
          <Route path="/life-advice" element={<LifeAdvice />} />
          <Route path="/my-temple" element={<MyTemple />} />
          <Route path="/focus-record" element={<FocusRecord />} />

          <Route
            path="/timer"
            element={
              <TimerPage
                key="main-timer"
                title="Main Timer"
                intentStorageKey={SACRED_INTENT_STORAGE_KEY}
                storageKey={MAIN_CHAIN_SESSION_KEY}
                durationPreferenceKey={MAIN_CHAIN_DURATION_KEY}
              />
            }
          />

          <Route
            path="/auxiliary-timer"
            element={
              <TimerPage
                key="aux-timer"
                durationSeconds={15 * 60}
                title="Auxiliary Timer"
                successPrefix="Auxiliary Session"
                intentStorageKey={SACRED_INTENT_STORAGE_KEY}
                durationPreferenceKey={AUX_CHAIN_DURATION_KEY}
                storageKey={AUX_CHAIN_SESSION_KEY}
                isAuxiliary
              />
            }
          />

          <Route path="/rsip" element={<RsipPage />} />
          <Route path="/core-principles" element={<CorePrinciples />} />

          {/* ⭐ TEMPORARY AUTH TEST PAGE */}
          {/* ⭐ TEMPORARY AUTH TEST PAGE */}
          <Route path="/auth-test" element={<AuthTest />} />

        </Route>

        <Route element={<NancyLayout />}>
          <Route path="/nancy" element={<PrivatePage />} />
          <Route path="/nancy/timeline" element={<Timeline />} />
          <Route path="/nancy/photos" element={<Photos />} />
          <Route path="/nancy/map" element={<Map />} />
          <Route path="/nancy/bucket-list" element={<BucketList />} />
          <Route path="/nancy/creative" element={<CreativeMoments />} />
          <Route path="/nancy/dictionary" element={<NancyDictionary />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
