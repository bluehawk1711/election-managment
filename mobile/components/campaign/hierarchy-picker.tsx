import { SelectField } from '@/components/campaign/select-field';
import { useReference } from '@/providers/reference-provider';
import { useTranslation } from 'react-i18next';

export type HierarchyValue = {
  wardId: string;
  areaId: string;
  boothId: string;
};

type Props = {
  value: HierarchyValue;
  onChange: (next: HierarchyValue) => void;
  /** Which levels to render — default all three. */
  levels?: ('ward' | 'area' | 'booth')[];
  labels?: Partial<Record<'ward' | 'area' | 'booth', string>>;
};

/**
 * Cascading Ward → Area → Booth picker. Changing a parent clears the
 * children so the value can never point at a hidden branch.
 */
export function HierarchyPicker({ value, onChange, levels, labels }: Props) {
  const { t } = useTranslation();
  const { wards, areas, booths } = useReference();
  const visible = levels ?? (['ward', 'area', 'booth'] as const);

  const wardOptions = wards.map((ward) => ({ value: ward.id, label: ward.name }));
  const areaOptions = areas
    .filter((area) => area.wardId === value.wardId)
    .map((area) => ({ value: area.id, label: area.name }));
  const boothOptions = booths
    .filter((booth) => booth.areaId === value.areaId)
    .map((booth) => ({ value: booth.id, label: `${t('common.booth')} ${booth.number}` }));

  return (
    <>
      {visible.includes('ward') ? (
        <SelectField
          label={labels?.ward ?? t('common.ward')}
          value={value.wardId}
          placeholder={t('form.selectWard')}
          options={wardOptions}
          onChange={(wardId) => onChange({ wardId, areaId: '', boothId: '' })}
        />
      ) : null}
      {visible.includes('area') ? (
        <SelectField
          label={labels?.area ?? t('common.area')}
          value={value.areaId}
          placeholder={value.wardId ? t('form.selectArea') : t('form.selectWardFirst')}
          options={areaOptions}
          disabled={!value.wardId}
          onChange={(areaId) => onChange({ ...value, areaId, boothId: '' })}
        />
      ) : null}
      {visible.includes('booth') ? (
        <SelectField
          label={labels?.booth ?? t('common.booth')}
          value={value.boothId}
          placeholder={
            value.areaId
              ? t('form.selectBooth')
              : value.wardId
                ? t('form.selectAreaFirst')
                : t('form.selectWardFirst')
          }
          options={boothOptions}
          disabled={!value.areaId}
          onChange={(boothId) => onChange({ ...value, boothId })}
        />
      ) : null}
    </>
  );
}
