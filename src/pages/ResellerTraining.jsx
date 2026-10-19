import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/api/supabaseClient';
import { useResellerAuth } from '@/lib/ResellerAuthContext';
import { GraduationCap, PlayCircle, FileText, CheckCircle, ChevronRight, ArrowLeft, Clock, BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

export default function ResellerTraining() {
  const { reseller } = useResellerAuth();
  const [courses, setCourses] = useState([]);
  const [activeCourse, setActiveCourse] = useState(null);
  const [lessons, setLessons] = useState([]);
  const [progress, setProgress] = useState({});
  const [activeLesson, setActiveLesson] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadCourses = useCallback(async () => {
    if (!reseller?.id) return;
    try {
      const { data: coursesData, error } = await supabase.from('reseller_courses').select('*').eq('is_published', true).order('sort_order');
      if (error) throw error;
      const { data: progressData } = await supabase.from('reseller_lesson_progress').select('lesson_id, completed').eq('reseller_id', reseller.id).eq('completed', true);
      const pm = {}; (progressData || []).forEach(p => { pm[p.lesson_id] = true; }); setProgress(pm);
      for (const course of (coursesData || [])) {
        const { count } = await supabase.from('reseller_course_lessons').select('id', { count: 'exact', head: true }).eq('course_id', course.id);
        course.lessonCount = count || 0;
        const { data: cl } = await supabase.from('reseller_course_lessons').select('id').eq('course_id', course.id);
        course.completedCount = (cl || []).filter(l => pm[l.id]).length;
      }
      setCourses(coursesData || []);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  }, [reseller?.id]);

  useEffect(() => { loadCourses(); }, [loadCourses]);

  const loadLessons = async (course) => {
    setActiveCourse(course); setActiveLesson(null);
    const { data } = await supabase.from('reseller_course_lessons').select('*').eq('course_id', course.id).order('sort_order');
    setLessons(data || []);
  };

  const markComplete = async (lessonId) => {
    try {
      const { error } = await supabase.from('reseller_lesson_progress').upsert({ reseller_id: reseller.id, lesson_id: lessonId, completed: true, completed_at: new Date().toISOString() }, { onConflict: 'reseller_id,lesson_id' });
      if (error) throw error;
      setProgress(p => ({ ...p, [lessonId]: true })); toast.success('Lesson completed!');
    } catch (err) { toast.error('Failed to update progress'); }
  };

  if (activeLesson) return (
    <div>
      <button onClick={() => setActiveLesson(null)} className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-200 mb-4"><ArrowLeft className="w-4 h-4" /> Back to {activeCourse.title}</button>
      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
        {activeLesson.video_url && <div className="aspect-video bg-black"><iframe src={activeLesson.video_url.replace('watch?v=', 'embed/')} className="w-full h-full" allowFullScreen title={activeLesson.title} /></div>}
        <div className="p-6">
          <div className="flex items-start justify-between mb-4">
            <div><h2 className="text-xl font-bold text-white">{activeLesson.title}</h2>{activeLesson.duration_minutes && <span className="text-sm text-gray-500 flex items-center gap-1 mt-1"><Clock className="w-3.5 h-3.5" /> {activeLesson.duration_minutes} min</span>}</div>
            {progress[activeLesson.id] ? <span className="flex items-center gap-1 text-green-400 text-sm font-medium"><CheckCircle className="w-4 h-4" /> Completed</span> : <Button onClick={() => markComplete(activeLesson.id)} size="sm" className="bg-green-600 hover:bg-green-700"><CheckCircle className="w-4 h-4 mr-1" /> Mark Complete</Button>}
          </div>
          {activeLesson.content && <div className="prose prose-invert prose-sm max-w-none text-gray-300 whitespace-pre-wrap">{activeLesson.content}</div>}
          {activeLesson.pdf_url && <a href={activeLesson.pdf_url} target="_blank" rel="noopener noreferrer" className="mt-4 flex items-center gap-2 text-sm text-green-400 hover:text-green-300 font-medium"><FileText className="w-4 h-4" /> Download PDF Material</a>}
        </div>
      </div>
    </div>
  );

  if (activeCourse) return (
    <div>
      <button onClick={() => { setActiveCourse(null); setLessons([]); }} className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-200 mb-4"><ArrowLeft className="w-4 h-4" /> All Courses</button>
      <div className="mb-6"><h1 className="text-2xl font-bold text-white">{activeCourse.title}</h1>{activeCourse.description && <p className="text-gray-400 text-sm mt-1">{activeCourse.description}</p>}</div>
      <div className="space-y-2">{lessons.map((lesson, idx) => {
        const completed = progress[lesson.id];
        return (<button key={lesson.id} onClick={() => setActiveLesson(lesson)} className="w-full bg-gray-900 rounded-xl border border-gray-800 p-4 flex items-center gap-4 hover:border-green-800 transition-colors text-left">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${completed ? 'bg-green-900/40 text-green-400' : 'bg-gray-800 text-gray-500'}`}>{completed ? <CheckCircle className="w-5 h-5" /> : idx + 1}</div>
          <div className="flex-1 min-w-0"><p className={`font-medium text-sm ${completed ? 'text-gray-500' : 'text-gray-200'}`}>{lesson.title}</p>
            <div className="flex items-center gap-3 mt-1">{lesson.duration_minutes && <span className="text-xs text-gray-500 flex items-center gap-1"><Clock className="w-3 h-3" /> {lesson.duration_minutes} min</span>}{lesson.video_url && <span className="text-xs text-gray-500 flex items-center gap-1"><PlayCircle className="w-3 h-3" /> Video</span>}{lesson.pdf_url && <span className="text-xs text-gray-500 flex items-center gap-1"><FileText className="w-3 h-3" /> PDF</span>}</div></div>
          <ChevronRight className="w-5 h-5 text-gray-600" />
        </button>);
      })}</div>
    </div>
  );

  return (
    <div>
      <div className="mb-6"><h1 className="text-2xl font-bold text-white">Training</h1><p className="text-gray-400 text-sm mt-1">Complete courses to boost your sales skills</p></div>
      {loading ? <div className="text-center py-12 text-gray-500">Loading courses...</div> : courses.length === 0 ? (
        <div className="text-center py-12"><GraduationCap className="w-12 h-12 text-gray-700 mx-auto mb-3" /><p className="text-gray-500">No courses available yet</p></div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">{courses.map(course => {
          const pct = course.lessonCount ? Math.round((course.completedCount / course.lessonCount) * 100) : 0;
          return (<button key={course.id} onClick={() => loadLessons(course)} className="bg-gray-900 rounded-xl border border-gray-800 p-5 hover:border-green-800 transition-colors text-left">
            <div className="flex items-start justify-between mb-3"><div className="w-10 h-10 bg-green-900/30 rounded-lg flex items-center justify-center"><BookOpen className="w-5 h-5 text-green-400" /></div>{pct === 100 && <span className="text-xs font-medium text-green-400 bg-green-900/30 px-2 py-1 rounded-full">Complete ✓</span>}</div>
            <h3 className="font-semibold text-white mb-1">{course.title}</h3>{course.description && <p className="text-sm text-gray-400 mb-3 line-clamp-2">{course.description}</p>}
            <div className="flex items-center gap-3"><div className="flex-1 bg-gray-800 rounded-full h-2"><div className="bg-green-500 rounded-full h-2 transition-all" style={{ width: `${pct}%` }} /></div><span className="text-xs text-gray-500 whitespace-nowrap">{course.completedCount}/{course.lessonCount}</span></div>
          </button>);
        })}</div>
      )}
    </div>
  );
}
