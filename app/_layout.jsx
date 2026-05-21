import { Stack } from 'expo-router';
import { useFonts, Inter_400Regular, Inter_700Bold, Inter_900Black } from '@expo-google-fonts/inter';
import { ActivityIndicator, View, StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context'; // REQUIRED for the bottom bar fix

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_700Bold,
    Inter_900Black,
  });

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#020617' }}>
        <ActivityIndicator size="small" color="#0EA5E9" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor="#020617" />

      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#020617' },
          animation: 'fade',
        }}
      >
        <Stack.Screen name="(tabs)" />
        {/* <Stack.Screen name="welcome" /> */}
      </Stack>
    </SafeAreaProvider>
  );
}