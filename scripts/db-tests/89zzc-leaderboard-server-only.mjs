// Leaderboard rows come only from the server's grading (migration 10500): nobody signed in
// can add points for themselves directly.
export default async function ({ expectError, U }) {
  console.log("\nLeaderboard: written by the server only");
  await expectError("a student can't add leaderboard rows directly", U.studentA,
    "insert into leaderboard_entries (game_id, rank, player_id, score) values (gen_random_uuid(), 1, gen_random_uuid(), 9999)", /permission denied|row-level security/);
  await expectError("…nor can staff", U.teacherA,
    "insert into leaderboard_entries (game_id, rank, player_id, score) values (gen_random_uuid(), 1, gen_random_uuid(), 9999)", /permission denied|row-level security/);
}
