'use client';

/**
 * The voter roll page — DELIBERATELY a redirect, not a list.
 *
 * The panel's `/voters` screen rendered all 6 855 imported voters: a table
 * nobody scrolls, over a tree the rules refuse to read in bulk anyway
 * (`voters/$id` has no collection-level `.read`, and `votersByWard/{wardNo}`
 * costs a ward at a time). What a campaign manager actually asks the panel
 * is the other question — *what did my team change* — and that answer lives
 * on `/changes`, which reads only the per-account edit overlays and therefore
 * only ever touches the rows somebody actually touched.
 *
 * So the route stays (bookmarks, the mobile app's links, and the shell's own
 * history all still name it) and lands on the audit instead. Restoring the
 * roll later is a nav entry plus swapping this file back for the table — the
 * page it replaced is one `git revert` away, and nothing else in the panel
 * depends on it.
 */
import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function VoterRollPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/changes');
  }, [router]);

  return (
    <div className='grid min-h-[50vh] place-items-center'>
      <div className='flex items-center gap-3 text-sm text-mist-400'>
        <Loader2 className='size-4 animate-spin' />
        Opening voter changes — the roll itself is not shown in the panel.
      </div>
    </div>
  );
}
