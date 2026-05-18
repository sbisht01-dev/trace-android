import { Stack } from 'expo-router';
import { useFonts, Inter_400Regular, Inter_700Bold, Inter_900Black } from '@expo-google-fonts/inter';
import { ActivityIndicator, View, StatusBar } from 'react-native';

export default function RootLayout() {
  // 1. Load the Inter fonts globally
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_700Bold,
    Inter_900Black,
  });

  // 2. Show a clean loading spinner while fonts are loading
  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FFFFFF' }}>
        <ActivityIndicator size="small" color="#0EA5E9" />
      </View>
    );
  }

  return (
    <>
      {/* 3. Force the status bar icons (Time, Battery) to be dark for Light Mode */}
      <StatusBar barStyle="dark-content" />
      
      <Stack
        screenOptions={{
          headerShown: false, // Clean, minimal look (no top bars)
          contentStyle: { backgroundColor: '#FFFFFF' }, // Global Light Mode background
          animation: 'fade', // Smooth transitions between landing and map
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="map" />
      </Stack>
    </>
  );
}