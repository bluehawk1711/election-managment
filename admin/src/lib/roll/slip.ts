/**
 * The voter-slip payload builder — one function that turns a roll row plus
 * its ward's metadata into the exact `VoterSlipData` the slip component
 * renders. The mock (`admin/public/clipboard-image.png`) and the reference
 * PDF (`मतदाता_पर्ची_गंगा_2.pdf`) are the design of record; this file is where
 * the DATA half of that design lives, so the component stays a pure renderer.
 *
 * Every string is Hindi-first, exactly as the slip prints in the field: the
 * roll itself is a Hindi document, the karykarta reading it thinks in Hindi,
 * and the English half of the data (`nameEn` & co.) rides along only where
 * the mock shows it — the `(Name)` gloss beside नाम.
 *
 * The slip carries VOTER data only — no candidate block. The artefact a
 * karykarta hands a household is about one voter, and the panel has no
 * candidate configuration to print from anyway; bringing one back later
 * means restoring a block, not reshaping this contract.
 */
import type { VoterView, WardMeta } from './types';
import { genderLabel } from './types';

/**
 * The slip component's data contract — the pasted `VoterSlip.tsx` minus the
 * candidate block, so the component renders exactly what the roll knows.
 */
export interface VoterSlipData {
  title: string;
  badgeText?: string;
  /** The roll's generated English copy of the voter's name — the small
   *  line under the Hindi name on the bilingual slip. */
  nameEn?: string;
  rollLabel?: string;
  wardLabel?: string;
  voter: {
    name: string;
    fatherName: string;
    wardSerial: string | number;
    voterSerial: string | number;
    epic: string;
    houseNo: string | number;
    age: string | number;
    gender: string;
    photoUrl?: string;
    serialNo?: string | number;
  };
  booth: {
    number: string | number;
    name: string;
  };
  footerMessage?: string;
  votingTime?: string;
  /** Polling day, as the slip prints it under the voter block. */
  votingDate?: string;
}

/**
 * `VoterView` ⨯ `WardMeta` → the slip payload.
 *
 * The booth line comes from the WARD, not the row: one booth per ward
 * (`boothNo` + `boothAddress` + `roomNo` on `WardMeta`), so a row that lacks
 * a booth field cannot print a wrong one.
 */
export function buildSlipData(args: {
  voter: VoterView;
  ward: WardMeta | undefined;
  photoUrl?: string;
}): VoterSlipData {
  const { voter, ward, photoUrl } = args;
  const e = voter.effective;

  return {
    // The heading: panchayat election, ward, year — one line, bold.
    title: `ग्राम पंचायत चुनाव - वार्ड संख्या ${voter.wardNo} - 2026`,
    badgeText: 'मतदाता सूचना पर्ची (VOTER SLIP)',
    nameEn: voter.nameEn,
    rollLabel: 'निर्वाचक नामावली: मूल नामावली (Mother Roll)',
    wardLabel: `वार्ड ${String(voter.wardNo).padStart(2, '0')}`,
    voter: {
      name: e.name,
      fatherName: e.fatherOrHusbandName,
      wardSerial: voter.wardNo,
      voterSerial: voter.serialNo,
      epic: voter.epicId,
      houseNo: e.houseNo || '—',
      age: e.age,
      gender: genderLabel(e.gender),
      photoUrl,
      serialNo: voter.serialNo,
    },
    booth: {
      number: ward?.boothNo ?? '—',
      name: ward
        ? `${ward.boothAddress} (कमरा न. ${ward.roomNo})`
        : 'बूथ पता उपलब्ध नहीं',
    },
    footerMessage: 'लोकतंत्र के इस महापर्व में अपने अमूल्य मत का प्रयोग अवश्य करें',
    votingTime: '7:00 am से 06:00 pm',
    votingDate: 'रविवार 20 अक्टूबर 2026',
  };
}

/**
 * The plain-text summary the WhatsApp button sends — the slip in one
 * message, no HTML, so it reads the same in any WhatsApp client. Kept
 * beside the builder because both must stay in step field-for-field: a slip
 * that prints the EPIC but texts a stale one is worse than no button.
 */
export function slipMessageText(data: VoterSlipData): string {
  const lines = [
    `*${data.badgeText ?? 'मतदाता सूचना पर्ची'}*`,
    data.title,
    '',
    `नाम: ${data.voter.name}`,
    `पिता का नाम: ${data.voter.fatherName}`,
    `वार्ड: ${data.voter.wardSerial} | मतदाता क्रमांक: ${data.voter.voterSerial}`,
    `EPIC: ${data.voter.epic}`,
    `मकान नंबर: ${data.voter.houseNo} | आयु/लिंग: ${data.voter.age} वर्ष / ${data.voter.gender}`,
    `मतदान बूथ: ${data.booth.number} - ${data.booth.name}`,
  ];
  if (data.votingDate) lines.push(`मतदान दिनांक: ${data.votingDate}`);
  if (data.votingTime) lines.push(`मतदान का समय: ${data.votingTime}`);
  return lines.join('\n');
}
