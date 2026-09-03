import type { LucideIcon } from 'lucide-react-native';
import type { PropsWithChildren, JSX } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, fonts, fontSize, radius, spacing } from '../../lib/theme';

export interface EmptyStateProps extends PropsWithChildren {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
}

export function EmptyState({ icon: Icon, title, subtitle, children }: EmptyStateProps): JSX.Element {
  return (
    <View style={styles.container}>
      <View style={styles.iconCircle}>
        <Icon size={32} color={colors.rojo} />
      </View>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {children ? <View style={styles.actions}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxxl,
    paddingHorizontal: spacing.xl,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: radius.full,
    backgroundColor: colors.rojoSuave,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  title: {
    fontSize: fontSize.lg,
    color: colors.tinta,
    textAlign: 'center',
    marginBottom: spacing.xs,
    fontFamily: fonts.bold,
  },
  subtitle: {
    fontSize: fontSize.sm,
    color: colors.gris,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: spacing.lg,
    fontFamily: fonts.regular,
  },
  actions: {
    width: '100%',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
});
