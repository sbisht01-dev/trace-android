import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import MapView, { Polyline, Heatmap, UrlTile, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import * as SQLite from 'expo-sqlite';
import * as TaskManager from 'expo-task-manager';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const LOCATION_TASK_NAME = 'background-location-task';
const db = SQLite.openDatabaseSync('trace_db');

// --- 1. BACKGROUND TASK ---
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

// --- HEATMAP UI/UX CONFIG ---
const HEATMAP_GRADIENT = {
    colors: ["#FDE047", "#F97316", "#EA580C"], 
    startPoints: [0.1, 0.5, 0.9],
    colorMapSize: 256
};

export default function MapScreen() {
    const insets = useSafeAreaInsets();
    const mapRef = useRef(null);
    const lastSpeedUpdateTime = useRef(0);
    const trackingStartTime = useRef(null); 

    // --- CORE TRACKING STATES ---
    const [location, setLocation] = useState(null);
    const [path, setPath] = useState([]);
    const [isTracking, setIsTracking] = useState(false);
    const [distance, setDistance] = useState(0);
    const [elapsedTime, setElapsedTime] = useState(0);
    const [currentElevation, setCurrentElevation] = useState(0);
    const [currentSpeed, setCurrentSpeed] = useState(0);
    const [isFollowingUser, setIsFollowingUser] = useState(true);
    
    // --- GLOBAL HEATMAP STATE ---
    const [globalCoords, setGlobalCoords] = useState([]);

    // --- SETUP ---
    useEffect(() => {
        const setupDB = async () => {
            try { db.execSync("ALTER TABLE coordinates ADD COLUMN elevation REAL;"); } catch (e) { }
            db.execSync(`
                CREATE TABLE IF NOT EXISTS user_profile (id INTEGER PRIMARY KEY, weight_kg REAL, height_cm REAL);
                INSERT OR IGNORE INTO user_profile (id, weight_kg, height_cm) VALUES (1, 70.0, 170.0);
            `);
            loadGlobalHeatmap();
        };
        setupDB();
        centerOnUser();
    }, []);

    const loadGlobalHeatmap = () => {
        const result = db.getAllSync('SELECT latitude, longitude FROM coordinates') || [];
        setGlobalCoords(result);
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

    // --- TIMERS & SYNC ---
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

    
    const elementBottomOffset = (insets.bottom > 0 ? insets.bottom : 0) + 110;

    return (
        <View style={styles.container}>
            {/* --- OPEN STREET MAP (DARK MINIMAL) --- */}
            <MapView
                ref={mapRef}
                style={styles.map}
                provider={PROVIDER_GOOGLE}
                onPanDrag={() => setIsFollowingUser(false)}
                showsUserLocation={true}
                showsMyLocationButton={false}
            >
                <UrlTile urlTemplate="https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png" maximumZ={19} flipY={false} />

                {!isTracking && globalCoords && globalCoords.length > 0 && (
                    <Heatmap
                        points={globalCoords.map(p => ({
                            latitude: p.latitude,
                            longitude: p.longitude,
                            weight: 1
                        }))}
                        radius={20}
                        opacity={0.7}
                        gradient={HEATMAP_GRADIENT}
                    />
                )}

                {isTracking && (
                    <Polyline coordinates={path} strokeWidth={5} strokeColor="#0EA5E9" lineCap="round" />
                )}
            </MapView>

            <Text style={styles.attribution}>© OpenStreetMap contributors</Text>

            {/* Fixed wrapper structure with decoupled dynamic positioning rules */}
            <View style={[styles.overlay, { bottom: elementBottomOffset }]} pointerEvents="box-none">
                <View style={styles.contentWrapper}>
                    <TouchableOpacity style={[styles.locBtn, isFollowingUser && styles.locBtnActive]} onPress={centerOnUser}>
                        <Feather name="navigation" size={20} color={isFollowingUser ? "#0EA5E9" : "#94A3B8"} />
                    </TouchableOpacity>

                    <View style={styles.card}>
                        {isTracking ? (
                            <View style={styles.row}>
                                <View style={{ flex: 1 }}><Text style={styles.l}>DISTANCE</Text><Text style={styles.v}>{distance.toFixed(2)} <Text style={styles.u}>KM</Text></Text></View>
                                <View style={{ flex: 1 }}><Text style={styles.l}>TIME</Text><Text style={styles.v}>{Math.floor(elapsedTime / 60)}:{String(elapsedTime % 60).padStart(2, '0')}</Text></View>
                                <View style={{ flex: 1 }}><Text style={styles.l}>SPEED</Text><Text style={styles.v}>{currentSpeed.toFixed(1)} <Text style={styles.u}>KM/H</Text></Text></View>
                            </View>
                        ) : <View style={{ flex: 1 }}><Text style={styles.readyText}>READY TO TRACE</Text></View>}

                        <TouchableOpacity style={[styles.mainBtn, isTracking ? styles.stop : styles.start]} onPress={handleToggleTracking}>
                            <Feather name={isTracking ? "square" : "play"} size={24} color="#FFF" />
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </View>
    );
}

// --- UPDATED STYLESHEET ---
const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#020617' },
    map: { width: '100%', height: '100%' },
    attribution: { position: 'absolute', bottom: 240, right: 10, fontSize: 10, color: 'rgba(255,255,255,0.4)', zIndex: 1 },

    // Changed from absolute bottom tracking base layout rules to flexible anchor layer
    overlay: { position: 'absolute', width: '100%', alignItems: 'center', zIndex: 2 },
    contentWrapper: { width: '92%' },

    locBtn: { width: 54, height: 54, borderRadius: 27, backgroundColor: '#0F172A', alignSelf: 'flex-end', justifyContent: 'center', alignItems: 'center', marginBottom: 15, borderWidth: 1, borderColor: '#1E293B', shadowColor: '#000', shadowOpacity: 0.3 },
    locBtnActive: { borderColor: '#0EA5E9', backgroundColor: '#0F172A' },

    card: { backgroundColor: '#0F172A', padding: 20, borderRadius: 35, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#1E293B', shadowColor: '#000', shadowOpacity: 0.4 },
    row: { flex: 1, flexDirection: 'row', alignItems: 'center' },
    readyText: { fontWeight: '900', fontSize: 18, color: '#F8FAFC', letterSpacing: -0.5 },
    l: { fontWeight: '800', fontSize: 9, color: '#64748B', letterSpacing: 1, marginBottom: 2 },
    v: { fontWeight: '900', fontSize: 20, color: '#F8FAFC' },
    u: { fontSize: 10, color: '#64748B', fontWeight: '700' },

    mainBtn: { width: 60, height: 60, borderRadius: 30, justifyContent: 'center', alignItems: 'center' },
    start: { backgroundColor: '#0EA5E9' },
    stop: { backgroundColor: '#EF4444' }
});