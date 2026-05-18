import React from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { Feather } from '@expo/vector-icons';

const WalkStats = ({ walk, path }) => {
    if (!walk || !path || path.length < 2) {
        return (
            <View style={styles.container}>
                <Text style={styles.statLabel}>LOADING DATA...</Text>
            </View>
        );
    }
    if (!walk) return null;
    // --- CALCULATIONS ---
    // 1. Speeds (km/h)
    const speeds = path.map((point, index) => {
        if (index === 0) return 0;
        const prev = path[index - 1];
        const timeDiff = (point.timestamp - prev.timestamp) / 1000 / 3600; // hours
        if (timeDiff === 0) return 0;

        // Haversine distance for this segment
        const R = 6371;
        const dLat = (point.latitude - prev.latitude) * (Math.PI / 180);
        const dLon = (point.longitude - prev.longitude) * (Math.PI / 180);
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(prev.latitude * (Math.PI / 180)) * Math.cos(point.latitude * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const d = R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));

        return d / timeDiff; // speed = dist / time
    });

    const topSpeed = Math.max(...speeds);
    const durationHours = (walk.duration || 1) / 3600;
    const avgSpeed = (walk.distance || 0) / durationHours;
    // const avgSpeed = walk.distance / (walk.duration / 3600);

    // 2. Elevations
    const elevations = path.map(p => p.elevation || 0);
    const topElevation = Math.max(...elevations);
    const avgElevation = elevations.reduce((a, b) => a + b, 0) / elevations.length;

    const StatItem = ({ icon, label, value, unit }) => (
        <View style={styles.statBox}>
            <Feather name={icon} size={14} color="#94A3B8" />
            <Text style={styles.statLabel}>{label}</Text>
            <Text style={styles.statValue}>{value}<Text style={styles.statUnit}> {unit}</Text></Text>
        </View>
    );
    console.log(`Stats Debug: Walk ID: ${walk.id}, Path Points: ${path.length}`);
    console.log("object");
    return (
        <View style={styles.container}>
            <View style={styles.grid}>
                <StatItem icon="trending-up" label="TOP SPEED" value={topSpeed.toFixed(1)} unit="km/h" />
                <StatItem icon="activity" label="AVG SPEED" value={avgSpeed.toFixed(1)} unit="km/h" />
                <StatItem icon="arrow-up-right" label="MAX ELEV" value={Math.round(topElevation)} unit="m" />
                <StatItem icon="bar-chart-2" label="AVG ELEV" value={Math.round(avgElevation)} unit="m" />
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        backgroundColor: '#FFF',
        borderRadius: 25,
        padding: 20,
        marginTop: 10,
        borderWidth: 1,    // Add this
        // borderColor: 'red', // Add this
        elevation: 4,
        shadowColor: '#000',
        shadowOpacity: 0.05,
        shadowRadius: 10,
    },
    grid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
    },
    statBox: {
        width: '48%',
        marginBottom: 15,
    },
    statLabel: {
        fontSize: 9,
        fontWeight: '800',
        color: '#94A3B8',
        letterSpacing: 1,
        marginTop: 4,
        marginBottom: 2,
    },
    statValue: {
        fontSize: 18,
        fontWeight: '900',
        color: '#0F172A',
    },
    statUnit: {
        fontSize: 10,
        color: '#64748B',
        fontWeight: '600',
    }
});

export default WalkStats;