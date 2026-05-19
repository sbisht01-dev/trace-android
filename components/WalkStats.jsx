import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';

export default function WalkStats({ walk, path, userWeight = 70 }) {
    // Note: userWeight defaults to 70kg. Later, you can pass this in from your SQLite Profile table!
    
    if (!walk) return null;

    // --- 1. CORE CALCULATIONS ---
    const totalDistance = walk.distance ? walk.distance.toFixed(2) : "0.00";
    const timeInHours = walk.duration / 3600;
    
    // Total Time Formatting
    const hrs = Math.floor(walk.duration / 3600);
    const mins = Math.floor((walk.duration % 3600) / 60);
    const secs = walk.duration % 60;
    const totalTime = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}:${String(secs).padStart(2, '0')}`;

    // Average Speed
    const rawSpeed = timeInHours > 0 ? (walk.distance / timeInHours) : 0;
    const avgSpeed = rawSpeed.toFixed(1);

    // Average Elevation
    let avgElevation = "0";
    if (path && path.length > 0) {
        let sumElevation = 0;
        let validPoints = 0;
        path.forEach(point => {
            if (point.elevation) {
                sumElevation += point.elevation;
                validPoints++;
            }
        });
        if (validPoints > 0) {
            avgElevation = (sumElevation / validPoints).toFixed(0);
        }
    }

    // --- 2. MET & CALORIE MATH ---
    let currentMET = 3.3; // Default normal walk
    if (rawSpeed < 3.2) {
        currentMET = 2.0; // Stroll
    } else if (rawSpeed >= 3.2 && rawSpeed < 5.0) {
        currentMET = 3.3; // Normal walk
    } else if (rawSpeed >= 5.0 && rawSpeed < 6.5) {
        currentMET = 4.3; // Brisk walk
    } else if (rawSpeed >= 6.5) {
        currentMET = 8.3; // Jogging/Running
    }

    const caloriesBurned = (currentMET * userWeight * timeInHours).toFixed(0);

    // --- REUSABLE STAT BOX COMPONENT ---
    const StatBox = ({ icon, label, value, unit, isHero = false }) => (
        <View style={[styles.statBox, isHero && styles.heroBox]}>
            <View style={styles.iconRow}>
                <Feather name={icon} size={isHero ? 16 : 14} color={isHero ? "#0EA5E9" : "#0EA5E9"} />
                <Text style={styles.label}>{label}</Text>
            </View>
            <Text style={[styles.value, isHero && styles.heroValue]}>
                {value} <Text style={styles.unit}>{unit}</Text>
            </Text>
        </View>
    );

    return (
        <View style={styles.container}>
            <Text style={styles.title}>Session Summary</Text>
            
            {/* HERO STAT: Calories */}
            <StatBox 
                icon="flame" 
                label="CALORIES BURNED" 
                value={caloriesBurned} 
                unit="KCAL" 
                isHero={true}
            />

            {/* GRID STATS */}
            <View style={styles.grid}>
                <StatBox 
                    icon="activity" 
                    label="AVG SPEED" 
                    value={avgSpeed} 
                    unit="KM/H" 
                />
                <StatBox 
                    icon="trending-up" 
                    label="AVG ELEV." 
                    value={avgElevation} 
                    unit="M" 
                />
                <StatBox 
                    icon="clock" 
                    label="TOTAL TIME" 
                    value={totalTime} 
                    unit={hrs > 0 ? "" : "MIN"} 
                />
                <StatBox 
                    icon="map" 
                    label="DISTANCE" 
                    value={totalDistance} 
                    unit="KM" 
                />
            </View>
        </View>
    );
}

// --- DARK MODE STYLESHEET ---
const styles = StyleSheet.create({
    container: {
        backgroundColor: '#0F172A',
        padding: 20,
        borderRadius: 25,
        marginTop: 15,
        borderWidth: 1,
        borderColor: '#1E293B',
        shadowColor: '#000',
        shadowOpacity: 0.5,
        shadowRadius: 10,
        elevation: 5,
    },
    title: {
        color: '#F8FAFC',
        fontSize: 16,
        fontWeight: '900',
        marginBottom: 15,
        letterSpacing: -0.5,
    },
    grid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
    },
    statBox: {
        width: '48%', 
        backgroundColor: '#020617', 
        padding: 15,
        borderRadius: 18,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: '#1E293B',
    },
    heroBox: {
        width: '100%',
        backgroundColor: '#1E293B', // Slightly lighter to make it pop
        borderColor: '#334155',
        marginBottom: 15,
    },
    iconRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 10,
    },
    label: {
        color: '#94A3B8',
        fontSize: 10,
        fontWeight: '800',
        marginLeft: 6,
        letterSpacing: 0.5,
    },
    value: {
        color: '#F8FAFC',
        fontSize: 22,
        fontWeight: '900',
    },
    heroValue: {
        fontSize: 28,
        color: '#0EA5E9', // Orange color for the calories text
    },
    unit: {
        color: '#64748B',
        fontSize: 11,
        fontWeight: '700',
    }
});