import { StyleSheet, View, Text, TouchableOpacity, FlatList, ScrollView, Dimensions, Platform } from 'react-native';
import MapView, { Polyline, UrlTile, PROVIDER_GOOGLE } from 'react-native-maps';
import * as SQLite from 'expo-sqlite';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DateTimePicker from '@react-native-community/datetimepicker';
import { BarChart } from 'react-native-gifted-charts'; 
import WalkStats from '../../components/WalkStats';
import React, { useState, useEffect, memo, useCallback } from 'react'; 
import { useFocusEffect } from 'expo-router'; 

const db = SQLite.openDatabaseSync('trace_db');
const { width } = Dimensions.get('window');

// Dynamic widths for the luxury horizontal chart carousel
const CHART_CARD_WIDTH = width * 0.85; 
const CHART_DRAW_WIDTH = CHART_CARD_WIDTH - 80; // Accounts for card padding and Y-axis

// --- THUMBNAIL COMPONENT ---
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
            provider={PROVIDER_GOOGLE}
            initialRegion={{
                latitude: previewPath[0].latitude,
                longitude: previewPath[0].longitude,
                latitudeDelta: 0.005, longitudeDelta: 0.005,
            }}
            scrollEnabled={false}
            zoomEnabled={false}
            pitchEnabled={false}
            rotateEnabled={false}
        >
            <UrlTile urlTemplate="https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png" maximumZ={19} flipY={false} />
            <Polyline coordinates={previewPath} strokeWidth={3} strokeColor="#0EA5E9" />
        </MapView>
    );
});

export default function HistoryScreen() {
    const insets = useSafeAreaInsets();
    
    const [showListMode, setShowListMode] = useState(false);
    const [selectedWalk, setSelectedWalk] = useState(null); 
    
    const [fromDate, setFromDate] = useState(null);
    const [toDate, setToDate] = useState(null);
    const [showPicker, setShowPicker] = useState(false);
    const [pickerMode, setPickerMode] = useState('from');
    
    const [savedWalks, setSavedWalks] = useState([]);
    const [displayCoords, setDisplayCoords] = useState([]);
    const [userWeight, setUserWeight] = useState(70);
    const [allTimeStats, setAllTimeStats] = useState({ distance: 0, duration: 0, speed: 0, elevation: 0, calories: 0 });
    
    // Multi-Chart States
    const [distChartData, setDistChartData] = useState([]);
    const [timeChartData, setTimeChartData] = useState([]);
    const [speedChartData, setSpeedChartData] = useState([]);

// refresh screen after coming back from map or after deleting walks in the timeline
useFocusEffect(
    useCallback(() => {
        loadData(); 
    }, [])
);

    const loadData = () => {
        const walks = db.getAllSync('SELECT * FROM walks ORDER BY date DESC, time DESC');
        const profile = db.getFirstSync('SELECT weight_kg FROM user_profile WHERE id = 1');
        const weight = profile ? profile.weight_kg : 70;
        
        setSavedWalks(walks);
        setUserWeight(weight);

        let totDist = 0;
        let totDur = 0;
        walks.forEach(w => {
            totDist += w.distance || 0;
            totDur += w.duration || 0;
        });

        const elevResult = db.getFirstSync('SELECT AVG(elevation) as avgElev FROM coordinates WHERE elevation > 0');
        const avgElev = elevResult && elevResult.avgElev ? elevResult.avgElev : 0;
        const timeInHours = totDur / 3600;
        const avgSpeed = timeInHours > 0 ? totDist / timeInHours : 0;

        let currentMET = 3.3;
        if (avgSpeed < 3.2) currentMET = 2.0;
        else if (avgSpeed >= 3.2 && avgSpeed < 5.0) currentMET = 3.3;
        else if (avgSpeed >= 5.0 && avgSpeed < 6.5) currentMET = 4.3;
        else if (avgSpeed >= 6.5) currentMET = 8.3;

        setAllTimeStats({
            distance: totDist,
            duration: totDur,
            speed: avgSpeed,
            elevation: avgElev,
            calories: currentMET * weight * timeInHours
        });

        // --- WEEKLY AGGREGATION FOR 3 CHARTS ---
        const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const aggregatedDays = Array(7).fill(0).map((_, i) => {
            const d = new Date();
            d.setDate(d.getDate() - (6 - i));
            return {
                rawDate: d.toISOString().split('T')[0],
                label: labels[d.getDay()],
                distance: 0,
                duration: 0 // stored in seconds
            };
        });

        walks.forEach(w => {
            const match = aggregatedDays.find(day => day.rawDate === w.date);
            if (match) {
                match.distance += w.distance || 0;
                match.duration += w.duration || 0;
            }
        });

        // Map Distance Data (Blue)
        setDistChartData(aggregatedDays.map(day => ({
            value: parseFloat(day.distance.toFixed(1)) || 0.1,
            label: day.label,
            frontColor: day.distance > 0 ? '#0EA5E9' : 'rgba(255, 255, 255, 0.05)',
        })));

        // Map Time Data in Minutes (Green)
        setTimeChartData(aggregatedDays.map(day => {
            const mins = day.duration / 60;
            return {
                value: parseFloat(mins.toFixed(0)) || 0.1,
                label: day.label,
                frontColor: mins > 0 ? '#10B981' : 'rgba(255, 255, 255, 0.05)',
            };
        }));

        // Map Speed Data (Purple)
        setSpeedChartData(aggregatedDays.map(day => {
            const dayHrs = day.duration / 3600;
            const avgSpd = dayHrs > 0 ? (day.distance / dayHrs) : 0;
            return {
                value: parseFloat(avgSpd.toFixed(1)) || 0.1,
                label: day.label,
                frontColor: avgSpd > 0 ? '#8B5CF6' : 'rgba(255, 255, 255, 0.05)',
            };
        }));
    };

    const handleSelectWalk = (walk) => {
        const coords = db.getAllSync('SELECT latitude, longitude, elevation FROM coordinates WHERE walk_id = ?', [walk.id]);
        setDisplayCoords(coords);
        setSelectedWalk(walk);
    };

    const handleResetFilters = () => {
        setFromDate(null);
        setToDate(null);
    };

    const filteredWalks = savedWalks.filter(w => (!fromDate || w.date >= fromDate) && (!toDate || w.date <= toDate));
    const totHrs = Math.floor(allTimeStats.duration / 3600);
    const totMins = Math.floor((allTimeStats.duration % 3600) / 60);

    return (
        <View style={[styles.container, { paddingTop: insets.top + 20 }]}>
            
            <View style={styles.headerRow}>
                <Text style={styles.headerTitle}>
                    {selectedWalk ? 'Session' : showListMode ? 'Timeline' : 'Analytics'}
                </Text>
                
                {!selectedWalk && (
                    <TouchableOpacity style={styles.toggleBtn} onPress={() => setShowListMode(!showListMode)} activeOpacity={0.7}>
                        <Feather name={showListMode ? "pie-chart" : "list"} size={20} color="#FFFFFF" />
                    </TouchableOpacity>
                )}
            </View>

            <View style={styles.contentArea}>
                
                {selectedWalk ? (
                    <ScrollView style={styles.detailContainer} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
                        <TouchableOpacity style={styles.backBtn} onPress={() => setSelectedWalk(null)}>
                            <Feather name="arrow-left" size={18} color="#0EA5E9" />
                            <Text style={styles.backBtnText}>Back to Timeline</Text>
                        </TouchableOpacity>

                        <View style={styles.detailHeader}>
                            <Text style={styles.detailDate}>{selectedWalk.date}</Text>
                            <Text style={styles.detailTime}>Started at {selectedWalk.time}</Text>
                        </View>

                        <WalkStats walk={selectedWalk} path={displayCoords} userWeight={userWeight} />
                    </ScrollView>

                ) : showListMode ? (
                    <View style={{ flex: 1 }}>
                        <View style={styles.rangeBar}>
                            <TouchableOpacity style={styles.dateSelector} onPress={() => { setPickerMode('from'); setShowPicker(true); }}>
                                <Text style={styles.filterLabel}>FROM</Text>
                                <Text style={styles.filterValue}>{fromDate || 'Select'}</Text>
                            </TouchableOpacity>
                            <View style={styles.divider} />
                            <TouchableOpacity style={styles.dateSelector} onPress={() => { setPickerMode('to'); setShowPicker(true); }}>
                                <Text style={styles.filterLabel}>TO</Text>
                                <Text style={styles.filterValue}>{toDate || 'Select'}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.resetBtn} onPress={handleResetFilters}>
                                <Feather name="refresh-ccw" size={16} color="#64748B" />
                            </TouchableOpacity>
                        </View>

                        <FlatList 
                            data={filteredWalks}
                            keyExtractor={item => item.id}
                            showsVerticalScrollIndicator={false}
                            contentContainerStyle={{ paddingBottom: 140 }}
                            ListEmptyComponent={<Text style={styles.emptyText}>No tracking sequences recorded.</Text>}
                            renderItem={({ item }) => (
                                <TouchableOpacity style={styles.sessionItem} onPress={() => handleSelectWalk(item)} activeOpacity={0.8}>
                                    <View style={styles.thumbnailContainer}><ThumbnailMap walkId={item.id} /></View>
                                    <View style={styles.sessionInfo}>
                                        <Text style={styles.itemTitle}>{item.date} • {item.time}</Text>
                                        <Text style={styles.itemSub}>{item.distance.toFixed(2)}km • {Math.floor(item.duration / 60)}m</Text>
                                    </View>
                                    <Feather name="chevron-right" size={18} color="#475569" />
                                </TouchableOpacity>
                            )}
                        />
                    </View>

                ) : (
                    <ScrollView style={styles.overviewContainer} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 140 }}>
                        <View style={styles.heroCard}>
                            <Text style={styles.heroLabel}>TOTAL DISTANCE COALESCED</Text>
                            <Text style={styles.heroValue}>{allTimeStats.distance.toFixed(2)} <Text style={styles.heroUnit}>KM</Text></Text>
                        </View>

                        {/* --- HORIZONTAL CHART CAROUSEL --- */}
                        <ScrollView 
                            horizontal 
                            showsHorizontalScrollIndicator={false} 
                            snapToInterval={CHART_CARD_WIDTH + 16} // Snaps perfectly to the next card
                            decelerationRate="fast"
                            style={styles.chartScrollArea}
                            contentContainerStyle={styles.chartScrollContent}
                        >
                            {/* CHART 1: DISTANCE */}
                            <View style={[styles.chartCard, { width: CHART_CARD_WIDTH, marginRight: 16 }]}>
                                <View style={styles.chartHeaderRow}>
                                    <Text style={styles.chartTitle}>WEEKLY DISTANCE</Text>
                                    <Text style={[styles.chartTitleUnit, { color: '#0EA5E9' }]}>KM</Text>
                                </View>
                                <View style={styles.chartWrapper}>
                                    <BarChart data={distChartData} barWidth={20} capRadius={10} barBorderRadius={10} height={110} width={CHART_DRAW_WIDTH} noOfSections={3} spacing={18} xAxisThickness={0} yAxisThickness={0} hideRules yAxisTextStyle={styles.chartAxisText} xAxisLabelTextStyle={styles.chartAxisText} isAnimated />
                                </View>
                            </View>

                            {/* CHART 2: TIME */}
                            <View style={[styles.chartCard, { width: CHART_CARD_WIDTH, marginRight: 16 }]}>
                                <View style={styles.chartHeaderRow}>
                                    <Text style={styles.chartTitle}>WEEKLY DURATION</Text>
                                    <Text style={[styles.chartTitleUnit, { color: '#10B981' }]}>MIN</Text>
                                </View>
                                <View style={styles.chartWrapper}>
                                    <BarChart data={timeChartData} barWidth={20} capRadius={10} barBorderRadius={10} height={110} width={CHART_DRAW_WIDTH} noOfSections={3} spacing={18} xAxisThickness={0} yAxisThickness={0} hideRules yAxisTextStyle={styles.chartAxisText} xAxisLabelTextStyle={styles.chartAxisText} isAnimated />
                                </View>
                            </View>

                            {/* CHART 3: SPEED */}
                            <View style={[styles.chartCard, { width: CHART_CARD_WIDTH }]}>
                                <View style={styles.chartHeaderRow}>
                                    <Text style={styles.chartTitle}>AVERAGE VELOCITY</Text>
                                    <Text style={[styles.chartTitleUnit, { color: '#8B5CF6' }]}>KM/H</Text>
                                </View>
                                <View style={styles.chartWrapper}>
                                    <BarChart data={speedChartData} barWidth={20} capRadius={10} barBorderRadius={10} height={110} width={CHART_DRAW_WIDTH} noOfSections={3} spacing={18} xAxisThickness={0} yAxisThickness={0} hideRules yAxisTextStyle={styles.chartAxisText} xAxisLabelTextStyle={styles.chartAxisText} isAnimated />
                                </View>
                            </View>
                        </ScrollView>

                        <View style={styles.statsGrid}>
                            <View style={styles.statBox}>
                                <Feather name="zap" size={16} color="#0EA5E9" />
                                <Text style={styles.statLabel}>ENERGY COMBINED</Text>
                                <Text style={styles.statValue}>{allTimeStats.calories.toFixed(0)} <Text style={styles.smallUnit}>KCAL</Text></Text>
                            </View>
                            <View style={styles.statBox}>
                                <Feather name="clock" size={16} color="#10B981" />
                                <Text style={styles.statLabel}>DURATION</Text>
                                <Text style={styles.statValue}>{totHrs}h {totMins}m</Text>
                            </View>
                            <View style={styles.statBox}>
                                <Feather name="activity" size={16} color="#8B5CF6" />
                                <Text style={styles.statLabel}>AVG SPEEDS</Text>
                                <Text style={styles.statValue}>{allTimeStats.speed.toFixed(1)} <Text style={styles.smallUnit}>KM/H</Text></Text>
                            </View>
                            <View style={styles.statBox}>
                                <Feather name="trending-up" size={16} color="#EAB308" />
                                <Text style={styles.statLabel}>ELEVATION MU</Text>
                                <Text style={styles.statValue}>{allTimeStats.elevation.toFixed(0)} <Text style={styles.smallUnit}>M</Text></Text>
                            </View>
                        </View>
                    </ScrollView>
                )}
            </View>

            {showPicker && (
                <DateTimePicker 
                    value={new Date()} mode="date" 
                    onChange={(e, d) => { setShowPicker(false); if(d) { const s = d.toISOString().split('T')[0]; pickerMode === 'from' ? setFromDate(s) : setToDate(s); } }} 
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#020617', paddingHorizontal: 24 },
    headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
    headerTitle: { fontSize: 32, fontWeight: '800', color: '#FFFFFF', letterSpacing: -1 },
    toggleBtn: { backgroundColor: 'rgba(255, 255, 255, 0.04)', padding: 14, borderRadius: 100, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255, 255, 255, 0.08)' },
    contentArea: { flex: 1 },

    overviewContainer: { flex: 1 },
    heroCard: { backgroundColor: 'rgba(255, 255, 255, 0.02)', paddingVertical: 32, paddingHorizontal: 24, borderRadius: 36, alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255, 255, 255, 0.06)', marginBottom: 16 },
    heroLabel: { color: '#475569', fontSize: 10, fontWeight: '800', letterSpacing: 2, marginBottom: 6 },
    heroValue: { color: '#FFFFFF', fontSize: 52, fontWeight: '900', letterSpacing: -2.5 },
    heroUnit: { fontSize: 18, color: '#0EA5E9', fontWeight: '800' },

    // Chart Carousel
    chartScrollArea: { marginHorizontal: -24, marginBottom: 16 },
    chartScrollContent: { paddingHorizontal: 24 },
    chartCard: {
        backgroundColor: 'rgba(255, 255, 255, 0.02)',
        borderRadius: 36,
        padding: 24,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: 'rgba(255, 255, 255, 0.06)',
    },
    chartHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
    chartTitle: { color: '#475569', fontSize: 10, fontWeight: '800', letterSpacing: 2 },
    chartTitleUnit: { fontSize: 10, fontWeight: '900', letterSpacing: 1 },
    chartWrapper: { alignSelf: 'center', marginLeft: -12 }, // Shifts the chart over slightly to balance the Y-axis text
    chartAxisText: { color: '#475569', fontSize: 10, fontWeight: '700', fontFamily: Platform.OS === 'ios' ? 'Helvetica' : 'sans-serif' },

    statsGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
    statBox: { width: '48%', backgroundColor: 'rgba(255, 255, 255, 0.015)', padding: 20, borderRadius: 28, marginBottom: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255, 255, 255, 0.04)' },
    statLabel: { color: '#475569', fontSize: 9, fontWeight: '800', marginTop: 12, marginBottom: 4, letterSpacing: 1 },
    statValue: { color: '#FFFFFF', fontSize: 20, fontWeight: '800', letterSpacing: -0.5 },
    smallUnit: { fontSize: 11, color: '#475569', fontWeight: '700' },

    rangeBar: { flexDirection: 'row', backgroundColor: 'rgba(255, 255, 255, 0.02)', borderRadius: 24, padding: 16, alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255, 255, 255, 0.06)', marginBottom: 20 },
    dateSelector: { flex: 1, alignItems: 'center' },
    divider: { width: StyleSheet.hairlineWidth, height: '80%', backgroundColor: 'rgba(255, 255, 255, 0.1)', marginHorizontal: 8 },
    filterLabel: { fontSize: 9, color: '#475569', fontWeight: '800', letterSpacing: 1.5 },
    filterValue: { color: '#FFFFFF', fontSize: 15, fontWeight: '700', marginTop: 4 },
    resetBtn: { padding: 12, backgroundColor: 'rgba(255, 255, 255, 0.04)', borderRadius: 16, marginLeft: 8 },
    emptyText: { color: '#475569', textAlign: 'center', marginTop: 60, fontSize: 14, fontWeight: '600' },

    sessionItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255, 255, 255, 0.06)' },
    thumbnailContainer: { width: 66, height: 66, borderRadius: 18, overflow: 'hidden', backgroundColor: 'rgba(255, 255, 255, 0.01)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255, 255, 255, 0.08)' },
    thumbnailMap: { width: '100%', height: '100%' },
    thumbnailPlaceholder: { width: 66, height: 66, borderRadius: 18, backgroundColor: 'rgba(255, 255, 255, 0.04)' },
    sessionInfo: { flex: 1, marginLeft: 16 },
    itemTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '800', letterSpacing: -0.4 },
    itemSub: { color: '#94A3B8', fontSize: 13, fontWeight: '600', marginTop: 5 },

    detailContainer: { flex: 1 },
    backBtn: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', paddingVertical: 10, paddingRight: 20, marginBottom: 12 },
    backBtnText: { color: '#0EA5E9', fontSize: 14, fontWeight: '800', marginLeft: 6 },
    detailHeader: { marginBottom: 10, paddingHorizontal: 4 },
    detailDate: { color: '#FFFFFF', fontSize: 26, fontWeight: '900', letterSpacing: -1 },
    detailTime: { color: '#64748B', fontSize: 14, fontWeight: '700', marginTop: 2 }
});