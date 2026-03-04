import React from 'react';
import { Outlet } from 'react-router-dom';
import { NancyThemeProvider } from '../../context/NancyThemeContext';

const NancyLayout = () => {
    return (
        <NancyThemeProvider>
            <Outlet />
        </NancyThemeProvider>
    );
};

export default NancyLayout;
