import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useNancyTheme } from '../context/NancyThemeContext';

const NancyNavbar = () => {
    const { theme, toggleTheme } = useNancyTheme();
    const location = useLocation();
    const isMapPage = location.pathname.includes('/map');

    const navStyle = ({ isActive }) => ({
        textDecoration: 'none',
        color: isActive ? '#be185d' : '#db2777',
        fontWeight: isActive ? '800' : '600',
        fontSize: '1rem',
        padding: '0.5rem 1rem',
        borderRadius: '20px',
        background: isActive ? 'rgba(255, 255, 255, 0.8)' : 'transparent',
        transition: 'all 0.2s ease',
        opacity: isActive ? 1 : 0.8
    });

    return (
        <div style={{
            position: 'absolute',
            top: '2rem',
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            background: 'rgba(255, 255, 255, 0.4)',
            backdropFilter: 'blur(10px)',
            padding: '0.5rem',
            borderRadius: '100px',
            boxShadow: '0 4px 20px rgba(236, 72, 153, 0.1)',
            zIndex: 50,
            whiteSpace: 'nowrap'
        }}>
            <NavLink to="/nancy" end style={navStyle}>Home</NavLink>
            <NavLink to="/nancy/timeline" style={navStyle}>Our Timeline</NavLink>
            <NavLink to="/nancy/photos" style={navStyle}>Photo Album</NavLink>
            <NavLink to="/nancy/bucket-list" style={navStyle}>Bucket List</NavLink>
            <NavLink to="/nancy/map" style={navStyle}>Map of Us</NavLink>

            {/* Theme Toggle Wrapper - Hidden on Map */}
            {!isMapPage && (
                <>
                    <div style={{ width: '1px', height: '20px', background: 'rgba(219, 39, 119, 0.2)', margin: '0 0.5rem' }}></div>

                    <button
                        onClick={toggleTheme}
                        title={`Switch to ${theme === 'pink' ? 'Green' : 'Pink'} Theme`}
                        style={{
                            width: '24px',
                            height: '24px',
                            borderRadius: '50%',
                            // If pink active, button is green (#4ade80 typically, or just green-ish). If green active, button is pink.
                            // Using hardcoded aesthetic colors:
                            background: theme === 'pink' ? '#dcfce7' : '#fce7f3',
                            // Add a ring/border of the color it represents
                            border: `2px solid ${theme === 'pink' ? '#166534' : '#be185d'}`,
                            cursor: 'pointer',
                            transition: 'transform 0.2s',
                            padding: 0
                        }}
                        onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.1)'}
                        onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
                    />
                </>
            )}
        </div>
    );
};

export default NancyNavbar;
