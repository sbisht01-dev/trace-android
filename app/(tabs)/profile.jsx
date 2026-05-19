import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, TextInput, TouchableOpacity, Alert, ScrollView } from 'react-native';
import * as SQLite from 'expo-sqlite';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';

const db = SQLite.openDatabaseSync('trace_db');

const generateBespokeUsername = () => {
    const elements = ['Cyber', 'Neon', 'Quantum', 'Shadow', 'Solar', 'Astro', 'Vortex', 'Cosmic', 'Phantom', 'Spectral'];
    const animals = ['Panther', 'Falcon', 'Viper', 'Lynx', 'Wolf', 'Raptor', 'Cobra', 'Raven', 'Grizzly', 'Kraken'];
    const randomElement = elements[Math.floor(Math.random() * elements.length)];
    const randomAnimal = animals[Math.floor(Math.random() * animals.length)];
    const randomNumber = Math.floor(100 + Math.random() * 900);
    return `${randomElement}${randomAnimal}_${randomNumber}`;
};

export default function ProfileScreen() {
    const insets = useSafeAreaInsets();
    const [weight, setWeight] = useState('');
    const [height, setHeight] = useState('');
    const [username, setUsername] = useState('');

    const loadProfileData = () => {
        try { db.execSync("ALTER TABLE user_profile ADD COLUMN username TEXT;"); } catch (e) { }

        const profile = db.getFirstSync('SELECT * FROM user_profile WHERE id = 1');
        if (profile) {
            setWeight(profile.weight_kg ? profile.weight_kg.toString() : '');
            setHeight(profile.height_cm ? profile.height_cm.toString() : '');
            
            if (profile.username) {
                setUsername(profile.username);
            } else {
                const uniqueTag = generateBespokeUsername();
                db.runSync('UPDATE user_profile SET username = ? WHERE id = 1', [uniqueTag]);
                setUsername(uniqueTag);
            }
        }
    };

    useEffect(() => {
        loadProfileData();
    }, []);

    const handleSaveProfile = () => {
        try {
            db.runSync('UPDATE user_profile SET weight_kg = ?, height_cm = ? WHERE id = 1', [parseFloat(weight) || 0, parseFloat(height) || 0]);
            Alert.alert("Success", "Profile metrics synchronized successfully.");
        } catch (error) {
            Alert.alert("Error", "Failed to update profile parameters.");
        }
    };

    const handleExportData = async () => {
        try {
            const profile = db.getFirstSync('SELECT * FROM user_profile WHERE id = 1');
            const walks = db.getAllSync('SELECT * FROM walks');
            const coordinates = db.getAllSync('SELECT * FROM coordinates');

            const exportData = {
                version: "1.0", exportDate: new Date().toISOString(), profile, walks, coordinates
            };

            const jsonString = JSON.stringify(exportData);
            const fileUri = `${FileSystem.cacheDirectory}trace_backup_${Date.now()}.json`;
            
            await FileSystem.writeAsStringAsync(fileUri, jsonString);
            
            const isAvailable = await Sharing.isAvailableAsync();
            if (isAvailable) {
                await Sharing.shareAsync(fileUri, { mimeType: 'application/json', dialogTitle: 'Export Trace Telemetry' });
            } else {
                Alert.alert("Sharing Unavailable", "Your device does not support file sharing.");
            }
        } catch (error) {
            Alert.alert("Export Failed", "Could not generate backup file.");
        }
    };

    const handleImportData = async () => {
        try {
            const result = await DocumentPicker.getDocumentAsync({
                type: ['application/json', '*/*'], copyToCacheDirectory: true,
            });

            if (result.canceled) return;

            const pickedUri = result.assets[0].uri;
            const response = await fetch(pickedUri);
            const fileContents = await response.text();
            
            const importData = JSON.parse(fileContents);

            if (!importData.walks || !importData.coordinates) {
                Alert.alert("Invalid File", "This file does not contain valid Trace telemetry data.");
                return;
            }

            Alert.alert(
                "Import Data",
                "This will merge the backup with your current data. Proceed?",
                [{ text: "Cancel", style: "cancel" }, { text: "Import", style: "destructive", onPress: () => processImport(importData) }]
            );
        } catch (error) {
            Alert.alert("Import Failed", "Could not read or parse the selected backup file safely.");
        }
    };

    const processImport = (data) => {
        try {
            if (data.profile) {
                db.runSync('UPDATE user_profile SET weight_kg = ?, height_cm = ?, username = ? WHERE id = 1', 
                    [data.profile.weight_kg || 70, data.profile.height_cm || 170, data.profile.username || username]);
            }
            data.walks.forEach(walk => {
                db.runSync('INSERT OR IGNORE INTO walks (id, date, time, distance, duration) VALUES (?, ?, ?, ?, ?)', [walk.id, walk.date, walk.time, walk.distance, walk.duration]);
            });
            data.coordinates.forEach(coord => {
                db.runSync('INSERT OR IGNORE INTO coordinates (id, walk_id, latitude, longitude, elevation, timestamp) VALUES (?, ?, ?, ?, ?, ?)', [coord.id, coord.walk_id, coord.latitude, coord.longitude, coord.elevation, coord.timestamp]);
            });
            
            // CRITICAL FIX: Reload the profile state immediately after import
            loadProfileData();
            
            Alert.alert("Sync Complete", "Telemetry data successfully restored.");
        } catch (error) {
            Alert.alert("Database Error", "Failed to merge imported data.");
        }
    };

    const handleWipeHistory = () => {
        Alert.alert(
            "Purge All Trace History",
            "This action is absolute and cannot be undone. Every session data log, map coordinate, and performance chart parameter will be erased.",
            [{ text: "Cancel", style: "cancel" }, { text: "Erase Everything", style: "destructive", onPress: () => executeDatabaseWipe() }]
        );
    };

    const executeDatabaseWipe = () => {
        try {
            db.runSync('DELETE FROM coordinates;');
            db.runSync('DELETE FROM walks;');
            
            // CRITICAL FIX: Clear the UI states instantly (Username is kept, but history is gone)
            Alert.alert("System Restored", "All spatial and temporal sessions have been entirely cleared.");
        } catch (error) {
            Alert.alert("Reset Failure", "An error occurred while dropping database entities.");
        }
    };

    return (
        <ScrollView style={[styles.container, { paddingTop: insets.top + 20 }]} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 140 }}>
            <Text style={styles.headerTitle}>User Profile</Text>

            <View style={styles.avatarBlock}>
                <View style={styles.avatarRing}>
                    <Feather name="user" size={32} color="#0EA5E9" />
                </View>
                <Text style={styles.usernameText}>{username || 'Generating...'}</Text>
            </View>

            <View style={styles.formArea}>
                <View style={styles.inputGroup}>
                    <Text style={styles.label}>WEIGHT (KG)</Text>
                    <TextInput style={styles.input} value={weight} onChangeText={setWeight} keyboardType="numeric" placeholder="0.0" placeholderTextColor="#475569" />
                </View>
                <View style={styles.inputGroup}>
                    <Text style={styles.label}>HEIGHT (CM)</Text>
                    <TextInput style={styles.input} value={height} onChangeText={setHeight} keyboardType="numeric" placeholder="0" placeholderTextColor="#475569" />
                </View>
                <TouchableOpacity style={styles.btn} onPress={handleSaveProfile} activeOpacity={0.8}>
                    <Text style={styles.btnText}>SAVE BIOMETRICS</Text>
                </TouchableOpacity>
            </View>

            <View style={styles.vaultArea}>
                <Text style={styles.vaultTitle}>TELEMETRY ARCHIVE</Text>
                <View style={styles.vaultRow}>
                    <TouchableOpacity style={styles.vaultBtn} onPress={handleExportData} activeOpacity={0.7}>
                        <Feather name="upload-cloud" size={20} color="#0EA5E9" style={{ marginBottom: 8 }} />
                        <Text style={styles.vaultBtnText}>Export Backup</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.vaultBtn} onPress={handleImportData} activeOpacity={0.7}>
                        <Feather name="download-cloud" size={20} color="#10B981" style={{ marginBottom: 8 }} />
                        <Text style={styles.vaultBtnText}>Import Data</Text>
                    </TouchableOpacity>
                </View>
                <Text style={styles.vaultHelper}>Your data belongs to you. Export your history as a JSON file to save it externally, or import a previous backup.</Text>
            </View>

            <TouchableOpacity style={styles.dangerZoneBtn} onPress={handleWipeHistory} activeOpacity={0.6}>
                <Feather name="trash-2" size={14} color="#EF4444" style={{ marginRight: 8 }} />
                <Text style={styles.dangerZoneText}>Clear All Activity History</Text>
            </TouchableOpacity>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#020617', paddingHorizontal: 24 },
    headerTitle: { fontSize: 32, fontWeight: '800', color: '#FFFFFF', letterSpacing: -1, marginBottom: 30 },
    avatarBlock: { alignItems: 'center', marginBottom: 36 },
    avatarRing: { width: 88, height: 88, borderRadius: 44, backgroundColor: 'rgba(255, 255, 255, 0.02)', justifyContent: 'center', alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255, 255, 255, 0.12)', shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.4, shadowRadius: 16 },
    usernameText: { color: '#FFFFFF', fontSize: 22, fontWeight: '800', letterSpacing: -0.5, marginTop: 14 },
    formArea: { marginBottom: 32 },
    inputGroup: { marginBottom: 24 },
    label: { color: '#64748B', fontSize: 10, fontWeight: '800', letterSpacing: 2, marginBottom: 10 },
    input: { backgroundColor: 'rgba(255, 255, 255, 0.03)', color: '#FFFFFF', paddingVertical: 16, paddingHorizontal: 20, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255, 255, 255, 0.08)', fontSize: 18, fontWeight: '700', letterSpacing: -0.2 },
    btn: { backgroundColor: '#0EA5E9', paddingVertical: 18, borderRadius: 20, alignItems: 'center', marginTop: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255, 255, 255, 0.2)', shadowColor: '#0EA5E9', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.35, shadowRadius: 20 },
    btnText: { color: '#FFFFFF', fontWeight: '900', letterSpacing: 1.5, fontSize: 13 },
    vaultArea: { backgroundColor: 'rgba(255, 255, 255, 0.02)', padding: 24, borderRadius: 28, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255, 255, 255, 0.06)', marginBottom: 32 },
    vaultTitle: { color: '#64748B', fontSize: 10, fontWeight: '800', letterSpacing: 2, marginBottom: 20, textAlign: 'center' },
    vaultRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
    vaultBtn: { flex: 1, backgroundColor: 'rgba(255, 255, 255, 0.03)', paddingVertical: 20, borderRadius: 20, alignItems: 'center', marginHorizontal: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255, 255, 255, 0.08)' },
    vaultBtnText: { color: '#F8FAFC', fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
    vaultHelper: { color: '#475569', fontSize: 11, fontWeight: '600', textAlign: 'center', lineHeight: 18, paddingHorizontal: 10 },
    dangerZoneBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 16, borderRadius: 20, backgroundColor: 'rgba(239, 68, 68, 0.02)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(239, 68, 68, 0.15)', alignSelf: 'center', width: '100%' },
    dangerZoneText: { color: '#EF4444', fontSize: 12, fontWeight: '700', letterSpacing: 0.2 }
});