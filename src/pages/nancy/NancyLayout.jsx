import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { isAuthorizedEmail } from '../../constants';
import { NancyThemeProvider } from '../../context/NancyThemeContext';

const NancyLayout = () => {
    const { user, loading } = useAuth();

    if (loading) {
        return <div style={{ padding: '2rem', textAlign: 'center' }}>Loading...</div>;
    }

    if (!user) {
        return <Navigate to="/login" replace />;
    }

    if (!isAuthorizedEmail(user.email)) {
        return (
            <div style={{
                padding: '4rem',
                textAlign: 'center',
                color: '#ef4444',
                maxWidth: '600px',
                margin: '0 auto'
            }}>
                <h1>Access Denied</h1>
                <p>Your account ({user.email}) is not authorized to view this page.</p>
                <p>This area is private.</p>
            </div>
        );
    }

    return (
        <NancyThemeProvider>
            <Outlet />
        </NancyThemeProvider>
    );
};

export default NancyLayout;
