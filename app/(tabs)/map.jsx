import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Platform } from 'react-native';
import MapView, { Polyline, UrlTile, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import * as SQLite from 'expo-sqlite';
import * as TaskManager from 'expo-task-manager';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const LOCATION_TASK_NAME = 'background-location-task';
const db = SQLite.openDatabaseSync('trace_db');

// --- BACKGROUND TASK ---
TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
    if (error) return;
    if (data) {
        try {
            const { locations } = data;
            const loc = locations[0];
            const activeWalk = db.getFirstSync('SELECT id FROM walks ORDER BY id DESC LIMIT 1');

            if (activeWalk && loc) {
                db.runSync(
                    'INSERT INTO coordinates (walk_id, latitude, longitude, elevation, timestamp) VALUES (?, ?, ?, ?, ?)',
                    [activeWalk.id, loc.coords.latitude, loc.coords.longitude, loc.coords.altitude || 0, loc.timestamp]
                );
            }
        } catch (dbError) {
            console.error("Background DB Lock:", dbError);
        }
    }
});

export default function MapScreen() {
    const insets = useSafeAreaInsets();
    const mapRef = useRef(null);
    const lastSpeedUpdateTime = useRef(0);
    const trackingStartTime = useRef(null);

    const [location, setLocation] = useState(null);
    const [path, setPath] = useState([]);
    const [isTracking, setIsTracking] = useState(false);
    const [distance, setDistance] = useState(0);
    const [elapsedTime, setElapsedTime] = useState(0);
    const [currentElevation, setCurrentElevation] = useState(0);
    const [currentSpeed, setCurrentSpeed] = useState(0);
    const [isFollowingUser, setIsFollowingUser] = useState(true);
    
    // --- NEW: HISTORICAL PATHS STATE (Replaces globalCoords) ---
    const [historicalPaths, setHistoricalPaths] = useState([]);

    useEffect(() => {
        const setupDB = () => {
            try {
                // 1. Initialize the Base Coordinates Entity Layer
                db.execSync(`
                    CREATE TABLE IF NOT EXISTS coordinates (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        walk_id TEXT,
                        latitude REAL,
                        longitude REAL,
                        timestamp INTEGER
                    );
                `);

                // 2. Safely inject the elevation tracking column frame if absent
                try {
                    db.execSync("ALTER TABLE coordinates ADD COLUMN elevation REAL;");
                } catch (migrationError) {
                    // Silent ignore: column already exists in schema
                }

                // 3. Initialize the Core Walks Data Structure
                db.execSync(`
                    CREATE TABLE IF NOT EXISTS walks (
                        id TEXT PRIMARY KEY,
                        date TEXT,
                        time TEXT,
                        distance REAL,
                        duration INTEGER
                    );
                `);

                // 4. Initialize User Profile Structure Safely
                db.execSync(`
                    CREATE TABLE IF NOT EXISTS user_profile (
                        id INTEGER PRIMARY KEY, 
                        weight_kg REAL, 
                        height_cm REAL,
                        username TEXT
                    );
                `);

                // 5. Isolate the row insertion query into its own single operational string execution
                db.runSync(`
                    INSERT OR IGNORE INTO user_profile (id, weight_kg, height_cm) 
                    VALUES (1, 70.0, 170.0);
                `);

                // 6. Hydrate local state vectors
                loadGlobalHeatmap();
            } catch (dbError) {
                console.error("Critical Schema Architecture Malfunction Details:", dbError);
            }
        };

        setupDB();
        centerOnUser();
    }, []);

    // --- NEW: MULTI-POLYLINE DATA LOADER ---
    const loadGlobalHeatmap = () => {
        // Fetch all coordinates, ordered by time so paths draw correctly
        const result = db.getAllSync('SELECT walk_id, latitude, longitude FROM coordinates ORDER BY timestamp ASC') || [];
        
        // Group them cleanly by walk_id so lines don't connect across different days
        const groupedPaths = {};
        result.forEach(point => {
            if (!groupedPaths[point.walk_id]) {
                groupedPaths[point.walk_id] = [];
            }
            groupedPaths[point.walk_id].push({ latitude: point.latitude, longitude: point.longitude });
        });

        // Save as an array of path arrays
        setHistoricalPaths(Object.values(groupedPaths));
    };

    const startBackgroundTracking = async () => {
        await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
            accuracy: Location.Accuracy.BestForNavigation, timeInterval: 5000, distanceInterval: 3,
            foregroundService: { notificationTitle: "Trace Active", notificationBody: "Recording your walk path...", notificationColor: "#0F172A" },
        });
    };

    const handleToggleTracking = async () => {
        const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
        const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();

        if (fgStatus !== 'granted' || bgStatus !== 'granted') {
            alert("Background and Foreground location permissions are required.");
            return;
        }

        if (!isTracking) {
            const newID = `WALK_${Date.now()}`;
            const now = new Date();
            trackingStartTime.current = Date.now();

            db.runSync('INSERT INTO walks (id, date, time, distance, duration) VALUES (?, ?, ?, ?, ?)',
                [newID, now.toISOString().split('T')[0], now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), 0, 0]
            );

            setIsTracking(true); setIsFollowingUser(true); setPath([]); setDistance(0); setElapsedTime(0); setCurrentSpeed(0);
            await startBackgroundTracking();
        } else {
            setIsTracking(false);
            const hasStarted = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
            if (hasStarted) await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);

            const finalDuration = trackingStartTime.current ? Math.floor((Date.now() - trackingStartTime.current) / 1000) : elapsedTime;
            db.runSync('UPDATE walks SET distance = ?, duration = ? WHERE id = (SELECT id FROM walks ORDER BY id DESC LIMIT 1)', [distance || 0, finalDuration || 0]);

            loadGlobalHeatmap();
            trackingStartTime.current = null;
        }
    };

    useEffect(() => {
        let interval = null;
        if (isTracking) {
            interval = setInterval(() => {
                if (trackingStartTime.current) setElapsedTime(Math.floor((Date.now() - trackingStartTime.current) / 1000));
            }, 1000);
        }
        return () => clearInterval(interval);
    }, [isTracking]);

    useEffect(() => {
        let sub = null;
        if (isTracking) {
            sub = Location.watchPositionAsync({ accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 3 }, (loc) => {
                const { latitude, longitude, altitude, speed } = loc.coords;
                setCurrentElevation(altitude);

                const now = Date.now();
                if (now - lastSpeedUpdateTime.current > 4000) {
                    setCurrentSpeed(speed ? speed * 3.6 : 0);
                    lastSpeedUpdateTime.current = now;
                }

                setPath(prev => {
                    const newPath = [...prev, { latitude, longitude, elevation: altitude, timestamp: loc.timestamp }];
                    if (prev.length > 0) {
                        const last = prev[prev.length - 1];
                        const R = 6371; const dLat = (latitude - last.latitude) * (Math.PI / 180); const dLon = (longitude - last.longitude) * (Math.PI / 180);
                        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(last.latitude * (Math.PI / 180)) * Math.cos(latitude * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
                        setDistance(prevD => prevD + R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))));
                    }
                    return newPath;
                });

                if (isFollowingUser) mapRef.current?.animateCamera({ center: { latitude, longitude }, zoom: 18 });
            });
        }
        return () => sub?.then(s => s.remove());
    }, [isTracking, isFollowingUser]);

    const centerOnUser = async () => {
        try {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') return;

            let loc = await Location.getLastKnownPositionAsync({});
            if (!loc) loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced, timeout: 5000 });

            if (loc) {
                setLocation(loc.coords); setIsFollowingUser(true);
                mapRef.current?.animateCamera({ center: { latitude: loc.coords.latitude, longitude: loc.coords.longitude }, zoom: 18, pitch: 0, heading: 0 }, { duration: 1000 });
            }
        } catch (error) { console.error("Error centering on user:", error); }
    };

    // --- PIXEL-PERFECT CALIBRATION ---
    const tabLayoutHeight = (Platform.OS === 'ios' ? 64 : 0) + insets.bottom;
    const elementBottomOffset = tabLayoutHeight;

    return (
        <View style={styles.container}>
            <MapView
                ref={mapRef}
                style={styles.map}
                provider={PROVIDER_GOOGLE}
                onPanDrag={() => setIsFollowingUser(false)}
                showsUserLocation={true}
                showsMyLocationButton={false}
            >
                <UrlTile urlTemplate="https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png" maximumZ={19} flipY={false} />

                {/* --- STRAVA STYLE PERSONAL HEATMAP --- */}
                {!isTracking && historicalPaths.map((historicalPath, index) => (
                    <Polyline 
                        key={`history-${index}`}
                        coordinates={historicalPath} 
                        strokeWidth={16} 
                        strokeColor="rgba(0, 119, 255, 0.3)" // 20% Opacity Deep Orange
                        lineCap="round" 
                        lineJoin="round"
                    />
                ))}

                {/* ACTIVE TRACING LINE */}
                {isTracking && (
                    <Polyline coordinates={path} strokeWidth={5} strokeColor="#0EA5E9" lineCap="round" lineJoin="round" />
                )}
            </MapView>

            <Text style={[styles.attribution, { bottom: elementBottomOffset + 120 }]}>© OpenStreetMap contributors</Text>

            <View style={[styles.overlay, { bottom: elementBottomOffset }]} pointerEvents="box-none">
                <View style={styles.contentWrapper}>
                    <TouchableOpacity style={[styles.locBtn, isFollowingUser && styles.locBtnActive]} onPress={centerOnUser}>
                        <Feather name="navigation" size={20} color={isFollowingUser ? "#0EA5E9" : "#475569"} />
                    </TouchableOpacity>

                    <View style={styles.card}>
                        {isTracking ? (
                            <View style={styles.metricsColumn}>
                                {/* Primary Primary Metric Block: Time */}
                                <View style={styles.primaryMetricRow}>
                                    <Text style={styles.l}>TIME ELAPSED</Text>
                                    <Text style={styles.vLarge}>
                                        {Math.floor(elapsedTime / 60)}:{String(elapsedTime % 60).padStart(2, '0')}
                                    </Text>
                                </View>

                                {/* Secondary Sub-Metrics Row: Distance & Speed split side-by-side */}
                                <View style={styles.secondaryMetricsGroup}>
                                    <View style={styles.subMetricBox}>
                                        <Text style={styles.l}>DISTANCE</Text>
                                        <Text style={styles.v}>{distance.toFixed(2)} <Text style={styles.u}>KM</Text></Text>
                                    </View>

                                    <View style={styles.subMetricBox}>
                                        <Text style={styles.l}>CURRENT SPEED</Text>
                                        <Text style={styles.v}>{currentSpeed.toFixed(1)} <Text style={styles.u}>KM/H</Text></Text>
                                    </View>
                                </View>
                            </View>
                        ) : <View style={{ flex: 1 }}><Text style={styles.readyText}>READY TO TRACE</Text></View>}

                        <TouchableOpacity style={[styles.mainBtn, isTracking ? styles.stop : styles.start]} onPress={handleToggleTracking}>
                            <Feather name={isTracking ? "square" : "play"} size={22} color="#FFF" />
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#020617' },
    map: { width: '100%', height: '100%' },
    attribution: { position: 'absolute', right: 12, fontSize: 10, color: 'rgba(255,255,255,0.2)', zIndex: 1 },

    overlay: { position: 'absolute', width: '100%', alignItems: 'center', zIndex: 2 },
    contentWrapper: { width: '90%' },

    locBtn: {
        width: 56, height: 56, borderRadius: 28,
        backgroundColor: 'rgba(2, 6, 23, 0.8)',
        alignSelf: 'flex-end', justifyContent: 'center', alignItems: 'center', marginBottom: 16,
        borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255, 255, 255, 0.12)',
        shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.4, shadowRadius: 16
    },
    locBtnActive: {
        borderColor: 'rgba(14, 165, 233, 0.4)',
        backgroundColor: 'rgba(15, 23, 42, 0.95)'
    },

    card: {
        backgroundColor: 'rgba(2, 6, 23, 0.85)',
        paddingVertical: 22, paddingHorizontal: 26,
        borderRadius: 36, flexDirection: 'row', alignItems: 'center',
        borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255, 255, 255, 0.1)',
        shadowColor: '#000', shadowOffset: { width: 0, height: 20 }, shadowOpacity: 0.5, shadowRadius: 28
    },
    row: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    readyText: { flex: 1, fontWeight: '800', fontSize: 18, color: '#FFFFFF', letterSpacing: -0.5 },

    l: { fontWeight: '800', fontSize: 9, color: '#475569', letterSpacing: 2, marginBottom: 4 },
    v: { fontWeight: '900', fontSize: 24, color: '#FFFFFF', letterSpacing: -1.5 },
    u: { fontSize: 12, color: '#0EA5E9', fontWeight: '800' },

    mainBtn: {
        width: 48, height: 48, borderRadius: 30, justifyContent: 'center', alignItems: 'center', marginLeft: 10,
        borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255, 255, 255, 0.15)'
    },
    start: {
        backgroundColor: '#0EA5E9',
        shadowColor: '#0EA5E9', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.35, shadowRadius: 12
    },
    stop: {
        backgroundColor: '#EF4444',
        shadowColor: '#EF4444', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.35, shadowRadius: 12
    },
    // --- VERTICAL METRICS LAYOUT ---
    metricsColumn: {
        flex: 1,
        flexDirection: 'column',
        gap: 16, 
    },
    primaryMetricRow: {
        flexDirection: 'column',
        alignItems: 'flex-start',
    },
    secondaryMetricsGroup: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        width: '100%',
    },
    subMetricBox: {
        flex: 1,
        flexDirection: 'column',
    },

    vLarge: {
        color: '#FFFFFF',
        fontSize: 38,
        fontWeight: '900',
        letterSpacing: -1.5,
        marginTop: 2,
    },
});