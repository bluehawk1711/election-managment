import { QuickAction } from '@/components/campaign/quick-action';
import { View } from '@/components/ui/view';
import { CalendarPlus, ListPlus, ScanLine, TriangleAlert } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';

type Props = {
  onNewTask: () => void;
  onReportIssue: () => void;
  onAddEvent: () => void;
  onBoothIn: () => void;
};

/** Four dashboard shortcuts under the hero. */
export function QuickActionsRow({ onNewTask, onReportIssue, onAddEvent, onBoothIn }: Props) {
  const { t } = useTranslation();

  return (
    <View style={styles.root}>
      <QuickAction icon={ListPlus} label={t('dash.newTask')} tone='primary' onPress={onNewTask} />
      <QuickAction icon={TriangleAlert} label={t('dash.reportIssue')} tone='danger' onPress={onReportIssue} />
      <QuickAction icon={CalendarPlus} label={t('dash.addEvent')} tone='info' onPress={onAddEvent} />
      <QuickAction icon={ScanLine} label={t('dash.boothIn')} tone='warning' onPress={onBoothIn} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    gap: 8,
  },
});
