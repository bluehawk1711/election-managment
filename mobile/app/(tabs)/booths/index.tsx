import { Chip } from '@/components/campaign/chip';
import { EmptyState } from '@/components/campaign/empty-state';
import { FilterBar, FilterItem } from '@/components/campaign/filter-bar';
import { ListRow } from '@/components/campaign/list-row';
import { SearchInput } from '@/components/campaign/search-input';
import { SectionHeader } from '@/components/campaign/section-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { ScrollView } from '@/components/ui/scroll-view';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { useColor } from '@/hooks/useColor';
import { useReference } from '@/providers/reference-provider';
import { useRouter } from 'expo-router';
import { ChevronRight, Vote } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

type StatusFilter = 'all' | 'ready' | 'unassigned';

/**
 * Booths tab — hierarchy filter chips (ward) + coordinator status + search,
 * matching the booths_management mock's list view.
 */
export default function BoothsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const reference = useReference();
  const outline = useColor('outline');

  const [query, setQuery] = useState('');
  const [wardId, setWardId] = useState('all');
  const [status, setStatus] = useState<StatusFilter>('all');

  const { booths, wards, loading, error, retry } = reference;

  const wardCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const booth of booths) {
      counts.set(booth.wardId, (counts.get(booth.wardId) ?? 0) + 1);
    }
    return counts;
  }, [booths]);

  const statusCounts = useMemo(
    () => ({
      ready: booths.filter((booth) => booth.coordinatorId).length,
      unassigned: booths.filter((booth) => !booth.coordinatorId).length,
    }),
    [booths]
  );

  const wardItems = useMemo<FilterItem[]>(
    () => [
      {
        key: 'all',
        label: `${t('common.all')} (${booths.length})`,
        active: wardId === 'all',
      },
      ...wards.map((ward) => ({
        key: ward.id,
        label: `${ward.name} (${wardCounts.get(ward.id) ?? 0})`,
        active: wardId === ward.id,
      })),
    ],
    [wards, wardCounts, booths.length, wardId, t]
  );

  const statusItems = useMemo<FilterItem[]>(
    () =>
      (
        [
          ['all', t('common.all'), booths.length],
          ['ready', t('booths.ready'), statusCounts.ready],
          ['unassigned', t('booths.unassigned'), statusCounts.unassigned],
        ] as [StatusFilter, string, number][]
      ).map(([key, label, count]) => ({
        key,
        label: `${label} (${count})`,
        active: status === key,
      })),
    [statusCounts, booths.length, status, t]
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return booths
      .filter((booth) => (wardId === 'all' ? true : booth.wardId === wardId))
      .filter((booth) =>
        status === 'all'
          ? true
          : status === 'ready'
            ? !!booth.coordinatorId
            : !booth.coordinatorId
      )
      .filter((booth) =>
        needle
          ? String(booth.number).includes(needle) ||
            booth.name.toLowerCase().includes(needle) ||
            booth.address.toLowerCase().includes(needle) ||
            reference.areaName(booth.areaId).toLowerCase().includes(needle)
          : true
      );
  }, [booths, wardId, status, query, reference]);

  const emptyFiltered = !loading && filtered.length === 0 && booths.length > 0;
  const emptyAll = !loading && booths.length === 0;

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={styles.pad}
      keyboardShouldPersistTaps='handled'
    >
      <SearchInput value={query} onChangeText={setQuery} />

      <FilterBar items={wardItems} onToggle={setWardId} />
      <FilterBar items={statusItems} onToggle={(key) => setStatus(key as StatusFilter)} />

      {error ? (
        <Card style={{ gap: 12 }}>
          <Text variant='caption'>{error}</Text>
          <Button size='sm' variant='outline' onPress={retry}>
            {t('common.retry')}
          </Button>
        </Card>
      ) : null}

      {loading ? (
        <View style={{ gap: 8 }}>
          {[0, 1, 2, 3].map((row) => (
            <Skeleton key={row} height={76} variant='rounded' />
          ))}
        </View>
      ) : emptyAll ? (
        <EmptyState
          icon={Vote}
          title={t('nav.booths')}
          body={t('booths.emptyBody')}
        />
      ) : emptyFiltered ? (
        <EmptyState
          icon={Vote}
          title={t('booths.noMatches')}
          body={t('booths.noMatchesBody')}
        />
      ) : (
        <View style={{ gap: 8 }}>
          <SectionHeader
            title={t('nav.booths')}
            hint={t('booths.count', { count: filtered.length })}
          />
          {filtered.map((booth) => {
            const staffed = !!booth.coordinatorId;
            return (
              <ListRow
                key={booth.id}
                title={reference.boothLabel(booth.id)}
                subtitle={[booth.name, reference.areaContext(booth.areaId)]
                  .filter(Boolean)
                  .join(' · ')}
                meta={
                  staffed
                    ? reference.memberName(booth.coordinatorId)
                    : t('booths.unassigned')
                }
                tone={staffed ? 'success' : 'danger'}
                onPress={() =>
                  router.push({
                    pathname: '/(tabs)/booths/[id]',
                    params: { id: booth.id },
                  })
                }
                trailing={
                  <View style={styles.trailing}>
                    <Chip
                      label={staffed ? t('booths.ready') : t('booths.unassigned')}
                      tone={staffed ? 'success' : 'danger'}
                    />
                    <Icon name={ChevronRight} size={18} color={outline} />
                  </View>
                }
              />
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pad: {
    padding: 20,
    paddingTop: 8,
    paddingBottom: 112,
    gap: 12,
  },
  trailing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
});
