import { Tabs } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { Platform, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function TabLayout() {
    const insets = useSafeAreaInsets(); 

    // Dynamic height adjustment to cleanly account for bottom system safe regions 
    // without crunching touch targets or creating awkward text clipping.
    const navigationBarHeight = (Platform.OS === 'ios' ? 64 : 68) + insets.bottom;

    return (
        <Tabs
            screenOptions={{
                headerShown: false, 
                
                // --- 1. LUXURY FIXED FRAME STRUCTURE ---
                tabBarStyle: {
                    // position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    
                    height: navigationBarHeight,
                    
                    // Elegant top-corner sweep instead of a floating capsule pill
                    borderTopLeftRadius: 28, 
                    borderTopRightRadius: 28, 
                    
                    // Deep 95% OLED Black layout layer
                    backgroundColor: '#020617', 
                    
                    // Razor-thin specular highlight line across the top edge
                    borderWidth: 0,
                    borderTopWidth: StyleSheet.hairlineWidth, 
                    borderTopColor: 'rgba(255, 255, 255, 0.08)', 
                    
                    // Completely flattened native elevation layers
                    elevation: 0, 
                    shadowOpacity: 0,
                    
                    // Strategic padding setup to offset bottom gesture bars smoothly
                    paddingBottom: insets.bottom > 0 ? insets.bottom - 4 : 12,
                    paddingHorizontal: 16,
                    overflow: 'hidden'
                },
                
                // --- 2. MICRO & MACRO TYPOGRAPHY CONFIG ---
                tabBarActiveTintColor: '#0EA5E9', // Electric Cyan
                tabBarInactiveTintColor: '#475569', // Muted technical slate
                tabBarLabelStyle: {
                    fontSize: 10,
                    fontWeight: '800',
                    letterSpacing: 1, // High-end tracked technical spacing
                    marginTop: 4,
                },
                tabBarItemStyle: {
                    paddingTop: 12,
                },
                tabBarHideOnKeyboard: true, 
            }}
        >
            <Tabs.Screen
                name="map" 
                options={{
                    title: 'TRACE',
                    tabBarIcon: ({ color, size }) => (
                        <Feather name="navigation" size={size - 2} color={color} />
                    ),
                }}
            />

            <Tabs.Screen
                name="history"
                options={{
                    title: 'HISTORY',
                    tabBarIcon: ({ color, size }) => (
                        <Feather name="clock" size={size - 2} color={color} />
                    ),
                }}
            />

            <Tabs.Screen
                name="profile"
                options={{
                    title: 'PROFILE',
                    tabBarIcon: ({ color, size }) => (
                        <Feather name="user" size={size - 2} color={color} />
                    ),
                }}
            />
        </Tabs>
    );
}