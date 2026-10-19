import { useState, useEffect } from 'react';
import { supabase } from '@/api/supabaseClient';
import { useResellerAuth } from '@/lib/ResellerAuthContext';
import { Trophy, Medal, Star } from 'lucide-react';

export default function ResellerLeaderboard() {
  const { reseller } = useResellerAuth();
  const [board, setBoard] = useState([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('month');

  useEffect(function() {
    async function load() {
      setLoading(true);
      try {
        // Get all resellers with their converted lead counts
        var { data: resellers } = await supabase
          .from('resellers')
          .select('id, full_name, commission_rate')
          .eq('status', 'approved');

        if (!resellers) { setBoard([]); setLoading(false); return; }

        // Get converted leads per reseller
        var now = new Date();
        var fromDate = period === 'month'
          ? new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
          : new Date(now.getFullYear(), 0, 1).toISOString();

        var { data: leads } = await supabase
          .from('reseller_leads')
          .select('reseller_id, status, created_at')
          .eq('status', 'converted')
          .gte('created_at', fromDate);

        var { data: comms } = await supabase
          .from('reseller_commissions')
          .select('reseller_id, amount')
          .gte('created_at', fromDate);

        var result = resellers.map(function(r) {
          var sales = (leads || []).filter(function(l) { return l.reseller_id === r.id; }).length;
          var earned = (comms || []).filter(function(c) { return c.reseller_id === r.id; }).reduce(function(s, c) { return s + Number(c.amount); }, 0);
          return { ...r, sales, earned };
        });

        result.sort(function(a, b) { return b.sales - a.sales || b.earned - a.earned; });
        setBoard(result);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [period]);

  var myRank = board.findIndex(function(r) { return r.id === reseller?.id; }) + 1;

  var rankIcon = function(i) {
    if (i === 0) return <Trophy className="w-5 h-5 text-yellow-400" />;
    if (i === 1) return <Medal className="w-5 h-5 text-gray-300" />;
    if (i === 2) return <Medal className="w-5 h-5 text-amber-600" />;
    return <span className="text-sm font-bold text-gray-500 w-5 text-center">#{i + 1}</span>;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Leaderboard</h1>
          <p className="text-gray-400 text-sm mt-1">Top performers this {period === 'month' ? 'month' : 'year'}.</p>
        </div>
        <div className="flex gap-2">
          {[['month', 'This Month'], ['year', 'This Year']].map(function(opt) {
            return (
              <button key={opt[0]} onClick={function() { setPeriod(opt[0]); }}
                className={'px-4 py-2 rounded-lg text-sm font-medium transition-colors ' + (period === opt[0] ? 'bg-green-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700')}>
                {opt[1]}
              </button>
            );
          })}
        </div>
      </div>

      {/* My rank */}
      {myRank > 0 && (
        <div className="bg-green-900/20 border border-green-800/40 rounded-xl p-4 flex items-center gap-4">
          <Star className="w-5 h-5 text-green-400" />
          <p className="text-sm text-gray-300">You're ranked <strong className="text-white">#{myRank}</strong> this {period === 'month' ? 'month' : 'year'}.</p>
        </div>
      )}

      {/* Top 3 podium */}
      {!loading && board.length >= 3 && (
        <div className="grid grid-cols-3 gap-3">
          {[board[1], board[0], board[2]].map(function(r, idx) {
            if (!r) return <div key={idx} />;
            var actualRank = board.indexOf(r);
            var heights = ['h-24', 'h-32', 'h-20'];
            var colors = ['bg-gray-700', 'bg-yellow-600', 'bg-amber-700'];
            return (
              <div key={r.id} className="flex flex-col items-center gap-2">
                <div className={'w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg ' + colors[idx]}>
                  {r.full_name?.[0]?.toUpperCase()}
                </div>
                <p className="text-xs font-medium text-gray-300 text-center truncate w-full px-1">{r.full_name?.split(' ')[0]}</p>
                <p className="text-xs text-gray-500">{r.sales} sales</p>
                <div className={'w-full rounded-t-lg ' + colors[idx] + ' ' + heights[idx]} />
              </div>
            );
          })}
        </div>
      )}

      {/* Full list */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-800">
          <h3 className="font-semibold text-white">All Resellers</h3>
        </div>
        {loading ? (
          <div className="p-8 text-center text-gray-500">Loading...</div>
        ) : board.length === 0 ? (
          <div className="p-8 text-center text-gray-500 text-sm">No data yet for this period.</div>
        ) : (
          <div className="divide-y divide-gray-800">
            {board.map(function(r, i) {
              var isMe = r.id === reseller?.id;
              return (
                <div key={r.id} className={'px-5 py-4 flex items-center gap-4 ' + (isMe ? 'bg-green-900/10' : '')}>
                  <div className="w-6 flex items-center justify-center shrink-0">{rankIcon(i)}</div>
                  <div className="w-9 h-9 rounded-full bg-gray-800 flex items-center justify-center text-white font-bold text-sm shrink-0">
                    {r.full_name?.[0]?.toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={'font-medium text-sm truncate ' + (isMe ? 'text-green-400' : 'text-white')}>
                      {r.full_name} {isMe && '(You)'}
                    </p>
                    <p className="text-xs text-gray-500">R{r.earned.toLocaleString()} earned</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-bold text-white">{r.sales}</p>
                    <p className="text-xs text-gray-500">sales</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Prizes */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h3 className="font-semibold text-white mb-3">🏆 Top Seller Prizes</h3>
        <div className="space-y-2">
          {[
            { place: '🥇 1st Place', prize: 'R500 cash + Canna Life Co merchandise + Extra commission' },
            { place: '🥈 2nd Place', prize: 'R250 cash + Canna Life Co merchandise' },
            { place: '🥉 3rd Place', prize: 'R100 cash + Canna Life Co merchandise' },
          ].map(function(p) {
            return (
              <div key={p.place} className="flex items-center gap-3 py-2">
                <span className="text-sm font-semibold text-white w-28 shrink-0">{p.place}</span>
                <span className="text-sm text-gray-400">{p.prize}</span>
              </div>
            );
          })}
        </div>
        <p className="text-xs text-gray-600 mt-3">Prizes awarded every Friday. Winners notified via WhatsApp.</p>
      </div>
    </div>
  );
}
