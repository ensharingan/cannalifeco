import { useState, useEffect } from 'react';
import { supabase } from '@/api/supabaseClient';
import { Download, FileText, Image, Video, MessageSquare, HelpCircle, DollarSign, ExternalLink } from 'lucide-react';

var TYPE_COLORS = {
  PDF: 'bg-red-900/40 text-red-400',
  DOC: 'bg-blue-900/40 text-blue-400',
  ZIP: 'bg-purple-900/40 text-purple-400',
  MP4: 'bg-green-900/40 text-green-400',
  MP3: 'bg-yellow-900/40 text-yellow-400',
};

var TYPE_ICONS = {
  PDF: FileText,
  DOC: MessageSquare,
  ZIP: Image,
  MP4: Video,
  MP3: Video,
};

export default function ResellerDownloads() {
  const [downloads, setDownloads] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(function() {
    async function load() {
      var { data } = await supabase
        .from('reseller_downloads')
        .select('*')
        .eq('is_active', true)
        .order('sort_order');
      setDownloads(data || []);
      setLoading(false);
    }
    load();
  }, []);

  // Group by category
  var grouped = downloads.reduce(function(acc, item) {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Downloads</h1>
        <p className="text-gray-400 text-sm mt-1">All your sales and marketing materials in one place.</p>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading...</div>
      ) : downloads.length === 0 ? (
        <div className="text-center py-12 text-gray-500 text-sm">No downloads available yet. Check back soon.</div>
      ) : (
        Object.entries(grouped).map(function([category, items]) {
          return (
            <div key={category} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-800">
                <h3 className="font-semibold text-white">{category}</h3>
              </div>
              <div className="divide-y divide-gray-800">
                {items.map(function(item) {
                  var Icon = TYPE_ICONS[item.file_type] || FileText;
                  var hasUrl = item.file_url && item.file_url.trim() !== '';
                  return (
                    <div key={item.id} className="px-5 py-4 flex items-center gap-4">
                      <div className="w-10 h-10 bg-gray-800 rounded-lg flex items-center justify-center shrink-0">
                        <Icon className="w-5 h-5 text-gray-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-white text-sm">{item.name}</p>
                        {item.description && <p className="text-xs text-gray-500 mt-0.5">{item.description}</p>}
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className={'px-2 py-0.5 rounded text-xs font-medium ' + (TYPE_COLORS[item.file_type] || 'bg-gray-800 text-gray-400')}>
                          {item.file_type}
                        </span>
                        {hasUrl ? (
                          <a href={item.file_url} target="_blank" rel="noreferrer"
                            className="flex items-center gap-1.5 bg-green-600 hover:bg-green-500 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors">
                            <Download className="w-3.5 h-3.5" /> Download
                          </a>
                        ) : (
                          <span className="text-xs text-gray-600 px-3 py-2">Coming soon</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })
      )}

      {/* WhatsApp group CTA */}
      <div className="bg-green-900/20 border border-green-800/40 rounded-xl p-5 flex items-center gap-4">
        <MessageSquare className="w-8 h-8 text-green-400 shrink-0" />
        <div className="flex-1">
          <p className="font-semibold text-white text-sm">Join the Cannalife Co Partners WhatsApp Group</p>
          <p className="text-xs text-gray-400 mt-0.5">Get daily targets, live support and weekly leaderboard updates.</p>
        </div>
        <a href="https://chat.whatsapp.com/KuOY7znkcaH8MhGNRCUVoj" target="_blank" rel="noreferrer"
          className="shrink-0 bg-green-600 hover:bg-green-500 text-white text-xs font-semibold px-4 py-2.5 rounded-lg transition-colors">
          Join Group
        </a>
      </div>
    </div>
  );
}
