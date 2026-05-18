import React, { useState, useEffect, useRef, memo } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Modal, FlatList } from 'react-native';
import MapView, { Polyline, Heatmap, UrlTile } from 'react-native-maps';
import * as Location from 'expo-location';
import * as SQLite from 'expo-sqlite';
import * as TaskManager from 'expo-task-manager';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DateTimePicker from '@react-native-community/datetimepicker';
import WalkStats from '../components/WalkStats';

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

// --- 2. DARK THUMBNAIL COMPONENT ---
const ThumbnailMap = memo(({ walkId }) => {
    const [previewPath, setPreviewPath] = useState([]);

    useEffect(() => {
        const coords = db.getAllSync('SELECT latitude, longitude FROM coordinates WHERE walk_id = ? LIMIT 50', [walkId]);
        setPreviewPath(coords);
    }, [walkId]);

    if (previewPath.length === 0) return <View style={styles.thumbnailPlaceholder} />;

    return (
        <MapView
            style={styles.thumbnailMap}
            liteMode={true}
            initialRegion={{
                latitude: previewPath[0].latitude,
                longitude: previewPath[0].longitude,
                latitudeDelta: 0.005, longitudeDelta: 0.005,
            }}
            scrollEnabled={false}
        >
            <UrlTile urlTemplate="https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png" maximumZ={19} flipY={false} />
            <Polyline coordinates={previewPath} strokeWidth={3} strokeColor="#0EA5E9" />
        </MapView>
    );
});

export default function MapScreen() {
    const insets = useSafeAreaInsets();
    const mapRef = useRef(null);
    const lastSpeedUpdateTime = useRef(0);

    // --- STATES ---
    const [location, setLocation] = useState(null);
    const [path, setPath] = useState([]);
    const [isTracking, setIsTracking] = useState(false);
    const [distance, setDistance] = useState(0);
    const [elapsedTime, setElapsedTime] = useState(0);
    const [currentElevation, setCurrentElevation] = useState(0);
    const [currentSpeed, setCurrentSpeed] = useState(0);
    const [isFollowingUser, setIsFollowingUser] = useState(true);

    const [savedWalks, setSavedWalks] = useState([]);
    const [displayCoords, setDisplayCoords] = useState([]);
    const [fromDate, setFromDate] = useState(null);
    const [toDate, setToDate] = useState(null);
    const [selectedWalkID, setSelectedWalkID] = useState(null);

    const [showPicker, setShowPicker] = useState(false);
    const [pickerMode, setPickerMode] = useState('from');
    const [showWalkPicker, setShowWalkPicker] = useState(false);

    // --- SETUP ---
    useEffect(() => {
        const setupDB = async () => {
            try { db.execSync("ALTER TABLE coordinates ADD COLUMN elevation REAL;"); } catch(e){}
            db.execSync(`
                CREATE TABLE IF NOT EXISTS walks (id TEXT PRIMARY KEY, date TEXT, time TEXT, distance REAL, duration INTEGER);
                CREATE TABLE IF NOT EXISTS coordinates (id INTEGER PRIMARY KEY AUTOINCREMENT, walk_id TEXT, latitude REAL, longitude REAL, elevation REAL, timestamp INTEGER);
            `);
            loadAllWalks();
        };
        setupDB();
        centerOnUser();
    }, []);

    const loadAllWalks = () => {
        const walks = db.getAllSync('SELECT * FROM walks ORDER BY date DESC, time DESC');
        setSavedWalks(walks);
    };

    // --- BUG-FIXED APPLY FILTERS ---
    const applyFilters = (start, end, walkId) => {
        try {
            let query = 'SELECT latitude, longitude, elevation, timestamp FROM coordinates';
            let params = [];

            if (walkId) {
                query = 'SELECT latitude, longitude, elevation, timestamp FROM coordinates WHERE walk_id LIKE ?';
                params = [`%${walkId}%`];
            } else if (start && end) {
                query = `SELECT c.latitude, c.longitude, c.elevation, c.timestamp FROM coordinates c JOIN walks w ON c.walk_id = w.id WHERE w.date BETWEEN ? AND ?`;
                params = [start, end];
            }

            const result = db.getAllSync(query, params) || [];
            setDisplayCoords(result);

            if (walkId && result.length > 0) {
                const firstPoint = result[0];
                mapRef.current?.animateToRegion({
                    latitude: firstPoint.latitude,
                    longitude: firstPoint.longitude,
                    latitudeDelta: 0.01, longitudeDelta: 0.01
                }, 1000);
            }
        } catch (error) {
            console.error("Database Filter Error:", error);
        }
    };

    // --- TRACKING HELPERS ---
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
            db.runSync('INSERT INTO walks (id, date, time, distance, duration) VALUES (?, ?, ?, ?, ?)', [newID, now.toISOString().split('T')[0], now.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}), 0, 0]);
            
            setIsTracking(true); setIsFollowingUser(true); setPath([]); setDistance(0); setElapsedTime(0); setCurrentSpeed(0); setSelectedWalkID(null);
            await startBackgroundTracking();
        } else {
            setIsTracking(false);
            const hasStarted = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
            if (hasStarted) await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);

            db.runSync('UPDATE walks SET distance = ?, duration = ? WHERE id = (SELECT id FROM walks ORDER BY id DESC LIMIT 1)', [distance || 0, elapsedTime || 0]);
            loadAllWalks();
        }
    };

    // --- TIMER & UI SYNC ---
    useEffect(() => {
        let interval = null;
        if (isTracking) interval = setInterval(() => setElapsedTime(p => p + 1), 1000);
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

    // --- ROBUST CENTER ON USER ---
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

    const filteredWalks = savedWalks.filter(w => (!fromDate || w.date >= fromDate) && (!toDate || w.date <= toDate));

    return (
        <View style={styles.container}>
            {!isTracking && (
                <View style={[styles.filterHeader, { marginTop: insets.top + 10 }]}>
                    <View style={styles.rangeBar}>
                        <TouchableOpacity style={styles.dateSelector} onPress={() => { setPickerMode('from'); setShowPicker(true); }}>
                            <Text style={styles.filterLabel}>FROM</Text>
                            <Text style={styles.filterValue}>{fromDate || 'Pick Date'}</Text>
                        </TouchableOpacity>
                        <View style={styles.divider} />
                        <TouchableOpacity style={styles.dateSelector} onPress={() => { setPickerMode('to'); setShowPicker(true); }}>
                            <Text style={styles.filterLabel}>TO</Text>
                            <Text style={styles.filterValue}>{toDate || 'Pick Date'}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.resetCircle} onPress={() => { setFromDate(null); setToDate(null); setSelectedWalkID(null); applyFilters(null,null,null); }}>
                            <Feather name="refresh-ccw" size={16} color="#94A3B8" />
                        </TouchableOpacity>
                    </View>

                    {fromDate && toDate && (
                        <TouchableOpacity style={styles.sessionSelect} onPress={() => setShowWalkPicker(true)}>
                            <Text style={styles.sessionText}>{selectedWalkID ? `Session: ${savedWalks.find(w => w.id === selectedWalkID)?.time}` : `Select Walk (${filteredWalks.length})`}</Text>
                            <Feather name="chevron-down" size={16} color="#F8FAFC" />
                        </TouchableOpacity>
                    )}
                    {selectedWalkID && <WalkStats walk={savedWalks.find(w => w.id === selectedWalkID)} path={displayCoords} />}
                </View>
            )}

            {showPicker && <DateTimePicker value={new Date()} mode="date" onChange={(e, d) => { setShowPicker(false); if(d) { const s = d.toISOString().split('T')[0]; pickerMode === 'from' ? setFromDate(s) : setToDate(s); applyFilters(pickerMode === 'from' ? s : fromDate, pickerMode === 'to' ? s : toDate, null); }}} maximumDate={new Date()} />}

            {/* --- OPEN STREET MAP (DARK MINIMAL) --- */}
            <MapView ref={mapRef} style={styles.map} onPanDrag={() => setIsFollowingUser(false)} showsUserLocation={true} showsMyLocationButton={false}>
                <UrlTile urlTemplate="https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png" maximumZ={19} flipY={false} />
                
                {!isTracking && !selectedWalkID && displayCoords.length > 0 && (
                    <Heatmap points={displayCoords} radius={40} opacity={0.6} gradient={{ colors: ["transparent", "#0284C7", "#0EA5E9", "#38BDF8"], startPoints: [0.1, 0.4, 0.7, 0.9], colorMapSize: 256 }} />
                )}
                
                {(isTracking || selectedWalkID) && (
                    <Polyline coordinates={isTracking ? path : displayCoords} strokeWidth={5} strokeColor="#0EA5E9" lineCap="round" />
                )}
            </MapView>
            
            <Text style={styles.attribution}>© OpenStreetMap contributors</Text>

            <Modal visible={showWalkPicker} transparent animationType="slide">
                <View style={styles.modalBg}>
                    <View style={[styles.modalBody, { maxHeight: '80%', width: '92%' }]}>
                        <Text style={styles.modalTitle}>History</Text>
                        <FlatList data={filteredWalks} keyExtractor={(item) => item.id} renderItem={({ item }) => (
                            <TouchableOpacity style={styles.sessionItem} onPress={() => { const targetId = String(item.id); applyFilters(null, null, targetId); setSelectedWalkID(targetId); setShowWalkPicker(false); }}>
                                <View style={styles.thumbnailContainer}><ThumbnailMap walkId={item.id} /></View>
                                <View style={styles.sessionInfo}><Text style={styles.itemText}>{item.time} • {item.date}</Text><Text style={styles.subText}>{item.distance.toFixed(2)}km • {Math.floor(item.duration / 60)}m</Text></View>
                                <Feather name="chevron-right" size={18} color="#475569" />
                            </TouchableOpacity>
                        )} />
                        <TouchableOpacity onPress={() => setShowWalkPicker(false)} style={styles.cancel}><Text style={styles.cancelBtnText}>Close</Text></TouchableOpacity>
                    </View>
                </View>
            </Modal>

            <View style={styles.overlay} pointerEvents="box-none">
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

// --- DARK MINIMAL STYLESHEET ---
const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#020617' },
    map: { width: '100%', height: '100%' },
    attribution: { position: 'absolute', bottom: 180, right: 10, fontSize: 10, color: 'rgba(255,255,255,0.4)', zIndex: 1 },
    
    filterHeader: { position: 'absolute', width: '90%', alignSelf: 'center', zIndex: 10 },
    rangeBar: { flexDirection: 'row', backgroundColor: '#0F172A', borderRadius: 25, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: '#1E293B', shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 10 },
    dateSelector: { flex: 1, alignItems: 'center' },
    divider: { width: 1, height: '50%', backgroundColor: '#1E293B' },
    filterLabel: { fontSize: 8, fontWeight: '800', color: '#64748B', letterSpacing: 1 },
    filterValue: { fontSize: 13, fontWeight: '700', color: '#F8FAFC' },
    resetCircle: { padding: 8 },
    
    sessionSelect: { marginTop: 10, backgroundColor: '#0F172A', padding: 16, borderRadius: 25, flexDirection: 'row', justifyContent: 'space-between', borderWidth: 1, borderColor: '#1E293B' },
    sessionText: { fontWeight: '700', fontSize: 13, color: '#F8FAFC' },
    
    modalBg: { flex: 1, backgroundColor: 'rgba(2, 6, 23, 0.8)', justifyContent: 'center', alignItems: 'center' },
    modalBody: { backgroundColor: '#0F172A', borderRadius: 35, padding: 25, borderWidth: 1, borderColor: '#1E293B' },
    modalTitle: { fontWeight: '900', fontSize: 22, marginBottom: 20, color: '#F8FAFC' },
    sessionItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1E293B' },
    
    thumbnailContainer: { width: 65, height: 65, borderRadius: 18, overflow: 'hidden', backgroundColor: '#020617', borderWidth: 1, borderColor: '#1E293B' },
    thumbnailMap: { width: '100%', height: '100%' },
    thumbnailPlaceholder: { width: 65, height: 65, borderRadius: 18, backgroundColor: '#1E293B' },
    sessionInfo: { flex: 1, marginLeft: 15 },
    itemText: { fontWeight: '700', fontSize: 15, color: '#F1F5F9' },
    subText: { fontSize: 12, color: '#64748B', marginTop: 2 },
    cancel: { marginTop: 20, alignSelf: 'center', padding: 10 },
    cancelBtnText: { fontWeight: '800', color: '#0EA5E9' },
    
    overlay: { position: 'absolute', bottom: 40, width: '100%', alignItems: 'center', zIndex: 2 },
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