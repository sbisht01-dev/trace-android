import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView } from 'react-native';
import { useRouter } from 'expo-router';
import { COLORS, FONTS } from '../constants/theme';

export default function WelcomeScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        
        {/* Top Branding Section */}
        <View style={styles.header}>
          <Text style={styles.logo}>TRACE</Text>
          <View style={styles.divider} />
          <Text style={styles.description}>
            A minimalist engine to visualize your daily movement. 
            No tracking, no selling, just your data.
          </Text>
        </View>

        {/* Bottom Action Section */}
        <View style={styles.footer}>
          <TouchableOpacity 
            style={styles.button} 
            onPress={() => router.push('/map')}
          >
            <Text style={styles.buttonText}>Get Started</Text>
          </TouchableOpacity>
          <Text style={styles.version}>VERSION 1.0.0</Text>
        </View>

      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.light.background },
  content: { flex: 1, justifyContent: 'space-between', padding: 40, paddingVertical: 80 },
  header: { alignItems: 'flex-start' },
  logo: { 
    fontFamily: FONTS.black, 
    fontSize: 52, 
    color: COLORS.light.text, 
    letterSpacing: -3 
  },
  divider: {
    width: 40,
    height: 4,
    backgroundColor: COLORS.light.primary,
    marginVertical: 20,
    borderRadius: 2
  },
  description: { 
    fontFamily: FONTS.medium, 
    fontSize: 18, 
    lineHeight: 28,
    color: COLORS.light.textMuted,
  },
  footer: { width: '100%' },
  button: { 
    backgroundColor: COLORS.light.text, // Clean black button for light mode
    paddingVertical: 22, 
    borderRadius: 24, 
    alignItems: 'center',
  },
  buttonText: { 
    fontFamily: FONTS.bold, 
    color: COLORS.light.surface, 
    fontSize: 18,
    letterSpacing: 1
  },
  version: {
    textAlign: 'center',
    marginTop: 24,
    fontFamily: FONTS.regular,
    fontSize: 10,
    color: COLORS.light.border,
    letterSpacing: 2
  }
});