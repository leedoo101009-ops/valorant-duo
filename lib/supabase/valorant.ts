// 클라이언트/프로필에 노출되는 전적 타입
export type ValorantMatch = {
  id: string;
  match_id: string;
  map_name: string;
  queue_id: string;
  agent_name: string;
  kills: number;
  deaths: number;
  assists: number;
  score: number;
  rounds_played: number;
  won: boolean;
  played_at: string;
};

export type ProfileWithSync = {
  last_match_sync_at: string | null;
};
