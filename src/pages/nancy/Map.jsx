import React, { useState, useEffect } from 'react';
import { db } from '../../firebase';
import { collection, query, onSnapshot, addDoc, deleteDoc, doc, updateDoc, serverTimestamp, orderBy } from 'firebase/firestore';
import { useAuth } from '../../context/AuthContext';
import NancyNavbar from '../../components/NancyNavbar';
import { useNancyTheme } from '../../context/NancyThemeContext';

// Leaflet Imports
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import EmojiPicker from 'emoji-picker-react';

// Fix for default markers
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png'),
    iconUrl: require('leaflet/dist/images/marker-icon.png'),
    shadowUrl: require('leaflet/dist/images/marker-shadow.png'),
});

// Custom Icons Generator
const createEmojiIcon = (emoji) => {
    return new L.DivIcon({
        className: 'custom-emoji-icon',
        html: `<div style="font-size: 2rem; text-shadow: 0 2px 5px rgba(0,0,0,0.2); text-align: center; line-height: 1;">${emoji}</div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 30], // Bottom center-ish
        popupAnchor: [0, -30]
    });
};

const Map = () => {
    const { user } = useAuth();
    const { currentBg } = useNancyTheme();
    const [locations, setLocations] = useState([]);
    const [isAddingMode, setIsAddingMode] = useState(false);
    const [tempCoords, setTempCoords] = useState(null); // Coords for new pin or editing pin
    const [formData, setFormData] = useState({ city: '', country: '', date: '', time: '', notes: '', customEmoji: '' });
    const [editingId, setEditingId] = useState(null); // ID of location being edited
    const [deleteId, setDeleteId] = useState(null); // ID of location to confirm delete
    const [showEmojiPicker, setShowEmojiPicker] = useState(false); // Toggle for emoji picker

    // Fetch Locations
    useEffect(() => {
        if (!user) return;
        const q = query(
            collection(db, 'users', user.uid, 'nancy_locations'),
            orderBy('createdAt', 'desc')
        );
        const unsubscribe = onSnapshot(q, (snapshot) => {
            setLocations(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        }, (error) => console.error(error));
        return () => unsubscribe();
    }, [user]);

    // Handle Escape Key to Cancel
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                setIsAddingMode(false);
                setTempCoords(null);
                setEditingId(null);
                setDeleteId(null);
                setShowEmojiPicker(false);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    const handleMapClick = (latlng) => {
        setTempCoords(latlng);
        setEditingId(null);
        setFormData({ city: '', country: '', date: '', time: '', notes: '', customEmoji: '📍' });
        setIsAddingMode(false);
        setShowEmojiPicker(false);
    };

    const handleEdit = (loc) => {
        setEditingId(loc.id);
        setFormData({
            city: loc.city || '',
            country: loc.country || '',
            date: loc.date || '',
            time: loc.time || '',
            notes: loc.notes || '',
            customEmoji: loc.customEmoji || '📍' // Default to pin if no emoji
        });
        setTempCoords({ lat: loc.lat, lng: loc.lng });
    };

    const handleSave = async (e) => {
        e.preventDefault();
        if (!user || !tempCoords) return;

        try {
            const dataToSave = {
                ...formData,
                lat: tempCoords.lat,
                lng: tempCoords.lng,
                // If user cleared the emoji box, default back to pin
                customEmoji: formData.customEmoji.trim() || '📍'
            };

            if (editingId) {
                // Update existing
                await updateDoc(doc(db, 'users', user.uid, 'nancy_locations', editingId), {
                    ...dataToSave,
                    updatedAt: serverTimestamp()
                });
            } else {
                // Create new
                await addDoc(collection(db, 'users', user.uid, 'nancy_locations'), {
                    ...dataToSave,
                    createdAt: serverTimestamp()
                });
            }
            // Reset
            setFormData({ city: '', country: '', date: '', time: '', notes: '', customEmoji: '' });
            setTempCoords(null);
            setEditingId(null);
            setShowEmojiPicker(false);
        } catch (error) {
            console.error("Error saving location:", error);
            alert("Failed to save location.");
        }
    };

    const confirmDelete = async () => {
        if (!user || !deleteId) return;
        try {
            await deleteDoc(doc(db, 'users', user.uid, 'nancy_locations', deleteId));
            setDeleteId(null);
        } catch (error) {
            console.error(error);
        }
    };

    // Separate mapped vs unmapped (legacy) locations
    const mappedLocations = locations.filter(l => l.lat && l.lng);
    const unmappedLocations = locations.filter(l => !l.lat || !l.lng);

    return (
        <div style={{
            height: '100vh',
            width: '100vw',
            background: currentBg,
            position: 'relative',
            overflow: 'hidden'
        }}>
            <NancyNavbar />

            {/* Map Container */}
            <MapContainer
                center={[39.8283, -98.5795]} // Center of USA approx
                zoom={4}
                minZoom={3} // Prevent zooming out too far
                maxBounds={[[-85, -180], [85, 180]]} // restrict view to the world (lat cut off at 85 to avoid weird projection issues)
                maxBoundsViscosity={1.0} // "hard" edge
                style={{ height: '100%', width: '100%', zIndex: 0 }}
                scrollWheelZoom={true}
            >
                <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    noWrap={true}
                />

                <LocationMarker isAdding={isAddingMode} onMapClick={handleMapClick} />

                {mappedLocations.map(loc => (
                    <Marker
                        key={loc.id}
                        position={[loc.lat, loc.lng]}
                        icon={createEmojiIcon(loc.customEmoji || '📍')}
                    >
                        <Popup>
                            <div style={{ textAlign: 'center', fontFamily: 'sans-serif' }}>
                                <div style={{ fontSize: '2rem', marginBottom: '0.2rem' }}>
                                    {loc.customEmoji || '📍'}
                                </div>
                                <h3 style={{ margin: '0 0 5px 0', color: '#be185d' }}>{loc.city}</h3>
                                {loc.date && (
                                    <div style={{ fontSize: '0.8rem', color: '#999', margin: '5px 0' }}>
                                        {new Date(loc.date + 'T12:00:00').toLocaleDateString()} {loc.time && <span>at {loc.time}</span>}
                                    </div>
                                )}
                                {loc.notes && <p style={{ margin: '5px 0', fontStyle: 'italic', textAlign: 'left' }}>{loc.notes}</p>}
                                <div style={{ display: 'flex', gap: '5px', justifyContent: 'center', marginTop: '8px' }}>
                                    <button
                                        onClick={() => handleEdit(loc)}
                                        style={{ background: '#3b82f6', color: 'white', border: 'none', borderRadius: '4px', padding: '4px 10px', cursor: 'pointer', fontSize: '0.7rem' }}
                                    >
                                        Edit
                                    </button>
                                    <button
                                        onClick={() => setDeleteId(loc.id)}
                                        style={{ background: '#ef4444', color: 'white', border: 'none', borderRadius: '4px', padding: '4px 10px', cursor: 'pointer', fontSize: '0.7rem' }}
                                    >
                                        Remove
                                    </button>
                                </div>
                            </div>
                        </Popup>
                    </Marker>
                ))}
            </MapContainer>

            {/* UI Overlay: Title & Add Button */}
            <div style={{
                position: 'absolute',
                top: '6rem',
                left: '2rem',
                zIndex: 40,
                pointerEvents: 'none' // Let clicks pass through to map
            }}>
                <h1 style={{
                    margin: 0,
                    color: '#be185d',
                    fontSize: '3rem',
                    textShadow: '2px 2px 0px white, -1px -1px 0 white, 1px -1px 0 white, -1px 1px 0 white, 1px 1px 0 white',
                    pointerEvents: 'auto'
                }}>
                    Map of Us🌏
                </h1>
                <p style={{
                    margin: '0.25rem 0 0 0',
                    color: '#be185d',
                    fontSize: '1.2rem',
                    fontWeight: 500,
                    textShadow: '1px 1px 0px white',
                    pointerEvents: 'auto'
                }}>
                    You know I love maps.
                </p>
            </div>

            {/* Instruction Banner when Adding */}
            {
                isAddingMode && (
                    <div style={{
                        position: 'absolute',
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        background: 'rgba(255, 255, 255, 0.9)',
                        padding: '1rem 2rem',
                        borderRadius: '50px',
                        boxShadow: '0 10px 30px rgba(0,0,0,0.2)',
                        zIndex: 1000,
                        pointerEvents: 'none', // Allow clicking through
                        textAlign: 'center'
                    }}>
                        <h2 style={{ margin: 0, color: '#be185d' }}>↓Tap anywhere on the map!</h2>
                        <p style={{ margin: '0.5rem 0 0 0', color: '#666' }}>(Zoom in for better precision)</p>
                    </div>
                )
            }

            {/* Floating Action Button */}
            {
                !tempCoords && (
                    <button
                        onClick={() => {
                            setIsAddingMode(!isAddingMode);
                            setTempCoords(null);
                        }}
                        style={{
                            position: 'absolute',
                            bottom: '3rem',
                            right: '3rem',
                            background: isAddingMode ? '#6b7280' : '#be185d',
                            color: 'white',
                            border: 'none',
                            borderRadius: '50px',
                            padding: '1rem 2rem',
                            fontSize: '1.2rem',
                            fontWeight: 'bold',
                            boxShadow: '0 4px 15px rgba(0,0,0,0.3)',
                            cursor: 'pointer',
                            zIndex: 1000,
                            transition: 'transform 0.2s',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem'
                        }}
                        onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.05)'}
                        onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
                    >
                        {isAddingMode ? 'Cancel' : '📍 Add Location'}
                    </button>
                )
            }

            {/* Modal Form for New/Edit Pin */}
            {
                tempCoords && (
                    <div style={{
                        position: 'absolute',
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        background: 'white',
                        padding: '2rem',
                        borderRadius: '24px',
                        boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
                        zIndex: 2000,
                        width: '90%',
                        maxWidth: '400px'
                    }}>
                        <h3 style={{ marginTop: 0, color: '#be185d' }}>{editingId ? 'Edit Location' : 'Add New Location'}</h3>
                        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

                            {/* Custom Emoji Input */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                <label style={{ fontSize: '0.85rem', color: '#666', marginLeft: '0.2rem' }}>
                                    Pin Icon
                                </label>
                                <div style={{ position: 'relative' }}>
                                    <button
                                        type="button"
                                        onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                                        style={{
                                            background: 'white',
                                            border: '1px solid #ddd',
                                            borderRadius: '12px',
                                            padding: '0.5rem 1rem',
                                            fontSize: '1.5rem',
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '0.5rem',
                                            boxShadow: '0 2px 5px rgba(0,0,0,0.05)'
                                        }}
                                    >
                                        {formData.customEmoji || '📍'}
                                        <span style={{ fontSize: '0.8rem', color: '#999', fontWeight: 'normal' }}>
                                            {showEmojiPicker ? 'Close Picker' : 'Change Icon'}
                                        </span>
                                    </button>

                                    {showEmojiPicker && (
                                        <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 50, marginTop: '0.5rem' }}>
                                            <EmojiPicker
                                                onEmojiClick={(emojiData) => {
                                                    setFormData({ ...formData, customEmoji: emojiData.emoji });
                                                    setShowEmojiPicker(false);
                                                }}
                                                width={300}
                                                height={400}
                                            />
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                <label style={{ fontSize: '0.85rem', color: '#666', marginLeft: '0.2rem' }}>
                                    Where is the place?
                                </label>
                                <input
                                    type="text"
                                    placeholder="Place Name (e.g. Navy Pier)"
                                    required
                                    value={formData.city}
                                    onChange={e => setFormData({ ...formData, city: e.target.value })}
                                    style={{ padding: '0.8rem', borderRadius: '8px', border: '1px solid #ddd' }}
                                />
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                <label style={{ fontSize: '0.85rem', color: '#666', marginLeft: '0.2rem' }}>
                                    Date <span style={{ fontWeight: 'normal', color: '#999' }}>(Optional - leave blank for permanent spots)</span>
                                </label>
                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                    <input
                                        type="date"
                                        value={formData.date}
                                        onChange={e => setFormData({ ...formData, date: e.target.value })}
                                        style={{ flex: 2, padding: '0.8rem', borderRadius: '8px', border: '1px solid #ddd' }}
                                    />
                                    <input
                                        type="time"
                                        value={formData.time}
                                        onChange={e => setFormData({ ...formData, time: e.target.value })}
                                        style={{ flex: 1, padding: '0.8rem', borderRadius: '8px', border: '1px solid #ddd' }}
                                    />
                                </div>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                <label style={{ fontSize: '0.85rem', color: '#666', marginLeft: '0.2rem' }}>
                                    What happened here?
                                </label>
                                <textarea
                                    placeholder="e.g. We had our first date here!"
                                    value={formData.notes}
                                    onChange={e => setFormData({ ...formData, notes: e.target.value })}
                                    style={{ padding: '0.8rem', borderRadius: '8px', border: '1px solid #ddd', minHeight: '80px' }}
                                />
                            </div>

                            <div style={{ display: 'flex', gap: '1rem' }}>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setTempCoords(null);
                                        setEditingId(null);
                                    }}
                                    style={{ flex: 1, padding: '0.8rem', borderRadius: '8px', border: 'none', background: '#ddd', cursor: 'pointer' }}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    style={{ flex: 1, padding: '0.8rem', borderRadius: '8px', border: 'none', background: '#be185d', color: 'white', fontWeight: 'bold', cursor: 'pointer' }}
                                >
                                    {editingId ? 'Update' : 'Save Pin'}
                                </button>
                            </div>
                        </form>
                    </div>
                )
            }

            {/* Custom Delete Confirmation Modal */}
            {
                deleteId && (
                    <div style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        background: 'rgba(0,0,0,0.5)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 3000
                    }} onClick={() => setDeleteId(null)}>
                        <div
                            onClick={e => e.stopPropagation()}
                            style={{
                                background: 'white',
                                padding: '2rem',
                                borderRadius: '20px',
                                textAlign: 'center',
                                maxWidth: '300px',
                                boxShadow: '0 10px 25px rgba(0,0,0,0.2)'
                            }}
                        >
                            <h3 style={{ margin: '0 0 1rem 0', color: '#be185d' }}>Delete this memory?</h3>
                            <p style={{ color: '#666', marginBottom: '1.5rem' }}>This cannot be undone.</p>
                            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
                                <button
                                    onClick={() => setDeleteId(null)}
                                    style={{ padding: '0.8rem 1.5rem', borderRadius: '12px', border: 'none', background: '#e5e7eb', cursor: 'pointer', fontWeight: 'bold' }}
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={confirmDelete}
                                    style={{ padding: '0.8rem 1.5rem', borderRadius: '12px', border: 'none', background: '#ef4444', color: 'white', cursor: 'pointer', fontWeight: 'bold' }}
                                >
                                    Delete
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Unmapped Legacy Data Warning */}
            {
                unmappedLocations.length > 0 && (
                    <div style={{
                        position: 'absolute',
                        bottom: '1rem',
                        left: '1rem',
                        background: 'rgba(255, 255, 255, 0.8)',
                        padding: '1rem',
                        borderRadius: '12px',
                        zIndex: 1000,
                        maxWidth: '300px',
                        fontSize: '0.8rem',
                        boxShadow: '0 4px 10px rgba(0,0,0,0.1)'
                    }}>
                        <strong>Unmapped Memories:</strong>
                        <ul style={{ paddingLeft: '1.2rem', marginTop: '0.5rem', marginBottom: 0 }}>
                            {unmappedLocations.map(l => (
                                <li key={l.id}>
                                    {l.city}
                                    <button
                                        onClick={() => setDeleteId(l.id)}
                                        style={{ marginLeft: '5px', border: 'none', background: 'none', cursor: 'pointer', color: 'red' }}>
                                        (x)
                                    </button>
                                </li>
                            ))}
                        </ul>
                        <div style={{ marginTop: '0.5rem', fontStyle: 'italic', color: '#666' }}>
                            *Please re-add these on the map!
                        </div>
                    </div>
                )
            }

        </div >
    );
};

// Component to handle map clicks needs to be defined outside or inside but we need to make sure we use it
const LocationMarker = ({ isAdding, onMapClick }) => {
    useMapEvents({
        click(e) {
            if (isAdding) {
                onMapClick(e.latlng);
            }
        },
    });
    return null;
};

export default Map;
