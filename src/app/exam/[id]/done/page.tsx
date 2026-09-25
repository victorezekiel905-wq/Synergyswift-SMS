/** Safe Exam Browser quit URL: SEB closes itself when it navigates here. */
export default function ExamDone() {
  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 p-6 text-center">
      <div>
        <p className="text-2xl font-semibold">Exam finished</p>
        <p className="mt-2 text-slate-600">You can close this window.</p>
      </div>
    </main>
  );
}
