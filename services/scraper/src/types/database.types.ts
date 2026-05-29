export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      feed_configurations: {
        Row: {
          created_at: string
          exclude_links: boolean
          forward_media: boolean
          id: string
          include_replies: boolean
          include_retweets: boolean
          include_videos: boolean
          is_active: boolean
          tracked_handle_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          exclude_links?: boolean
          forward_media?: boolean
          id?: string
          include_replies?: boolean
          include_retweets?: boolean
          include_videos?: boolean
          is_active?: boolean
          tracked_handle_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          exclude_links?: boolean
          forward_media?: boolean
          id?: string
          include_replies?: boolean
          include_retweets?: boolean
          include_videos?: boolean
          is_active?: boolean
          tracked_handle_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "feed_configurations_tracked_handle_id_fkey"
            columns: ["tracked_handle_id"]
            isOneToOne: false
            referencedRelation: "active_tracked_handles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feed_configurations_tracked_handle_id_fkey"
            columns: ["tracked_handle_id"]
            isOneToOne: false
            referencedRelation: "tracked_x_handles"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_limits: {
        Row: {
          allow_link_filter: boolean
          allow_video: boolean
          max_handles: number
          max_send_delay_ms: number
          min_send_delay_ms: number
          poll_interval_seconds: number
          remove_branding: boolean
          tier: Database["public"]["Enums"]["subscription_tier"]
        }
        Insert: {
          allow_link_filter?: boolean
          allow_video?: boolean
          max_handles: number
          max_send_delay_ms?: number
          min_send_delay_ms?: number
          poll_interval_seconds?: number
          remove_branding?: boolean
          tier: Database["public"]["Enums"]["subscription_tier"]
        }
        Update: {
          allow_link_filter?: boolean
          allow_video?: boolean
          max_handles?: number
          max_send_delay_ms?: number
          min_send_delay_ms?: number
          poll_interval_seconds?: number
          remove_branding?: boolean
          tier?: Database["public"]["Enums"]["subscription_tier"]
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      published_messages: {
        Row: {
          created_at: string
          error: string | null
          feed_configuration_id: string
          id: string
          sent_at: string | null
          status: Database["public"]["Enums"]["delivery_status"]
          tweet_id: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          feed_configuration_id: string
          id?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["delivery_status"]
          tweet_id: string
        }
        Update: {
          created_at?: string
          error?: string | null
          feed_configuration_id?: string
          id?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["delivery_status"]
          tweet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "published_messages_feed_configuration_id_fkey"
            columns: ["feed_configuration_id"]
            isOneToOne: false
            referencedRelation: "feed_configurations"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          id: string
          status: Database["public"]["Enums"]["subscription_status"]
          stripe_customer_id: string | null
          stripe_price_id: string | null
          stripe_subscription_id: string | null
          tier: Database["public"]["Enums"]["subscription_tier"]
          updated_at: string
          user_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          id?: string
          status?: Database["public"]["Enums"]["subscription_status"]
          stripe_customer_id?: string | null
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          tier?: Database["public"]["Enums"]["subscription_tier"]
          updated_at?: string
          user_id: string
        }
        Update: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          id?: string
          status?: Database["public"]["Enums"]["subscription_status"]
          stripe_customer_id?: string | null
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          tier?: Database["public"]["Enums"]["subscription_tier"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      tracked_x_handles: {
        Row: {
          created_at: string
          id: string
          last_cached_tweet_id: string | null
          last_polled_at: string | null
          poll_error_count: number
          screen_name: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_cached_tweet_id?: string | null
          last_polled_at?: string | null
          poll_error_count?: number
          screen_name: string
        }
        Update: {
          created_at?: string
          id?: string
          last_cached_tweet_id?: string | null
          last_polled_at?: string | null
          poll_error_count?: number
          screen_name?: string
        }
        Relationships: []
      }
      whatsapp_auth_state: {
        Row: {
          key: string
          session_id: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          session_id: string
          updated_at?: string
          value: Json
        }
        Update: {
          key?: string
          session_id?: string
          updated_at?: string
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_auth_state_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_sessions: {
        Row: {
          created_at: string
          id: string
          last_connected_at: string | null
          last_disconnect_reason: string | null
          last_disconnected_at: string | null
          phone_jid: string | null
          status: Database["public"]["Enums"]["whatsapp_status"]
          updated_at: string
          user_id: string
          whatsapp_channel_id: string | null
          whatsapp_channel_name: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          last_connected_at?: string | null
          last_disconnect_reason?: string | null
          last_disconnected_at?: string | null
          phone_jid?: string | null
          status?: Database["public"]["Enums"]["whatsapp_status"]
          updated_at?: string
          user_id: string
          whatsapp_channel_id?: string | null
          whatsapp_channel_name?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          last_connected_at?: string | null
          last_disconnect_reason?: string | null
          last_disconnected_at?: string | null
          phone_jid?: string | null
          status?: Database["public"]["Enums"]["whatsapp_status"]
          updated_at?: string
          user_id?: string
          whatsapp_channel_id?: string | null
          whatsapp_channel_name?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      active_tracked_handles: {
        Row: {
          created_at: string | null
          id: string | null
          last_cached_tweet_id: string | null
          last_polled_at: string | null
          poll_error_count: number | null
          screen_name: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string | null
          last_cached_tweet_id?: string | null
          last_polled_at?: string | null
          poll_error_count?: number | null
          screen_name?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string | null
          last_cached_tweet_id?: string | null
          last_polled_at?: string | null
          poll_error_count?: number | null
          screen_name?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      add_feed_configuration: {
        Args: {
          p_exclude_links?: boolean
          p_forward_media?: boolean
          p_include_replies?: boolean
          p_include_retweets?: boolean
          p_include_videos?: boolean
          p_screen_name: string
        }
        Returns: {
          created_at: string
          exclude_links: boolean
          forward_media: boolean
          id: string
          include_replies: boolean
          include_retweets: boolean
          include_videos: boolean
          is_active: boolean
          tracked_handle_id: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "feed_configurations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      add_tracked_handle: { Args: { p_screen_name: string }; Returns: string }
      due_handles: {
        Args: never
        Returns: {
          id: string
          poll_interval_seconds: number
          screen_name: string
        }[]
      }
      set_whatsapp_channel: {
        Args: { p_channel_id: string; p_channel_name?: string }
        Returns: {
          created_at: string
          id: string
          last_connected_at: string | null
          last_disconnect_reason: string | null
          last_disconnected_at: string | null
          phone_jid: string | null
          status: Database["public"]["Enums"]["whatsapp_status"]
          updated_at: string
          user_id: string
          whatsapp_channel_id: string | null
          whatsapp_channel_name: string | null
        }
        SetofOptions: {
          from: "*"
          to: "whatsapp_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      delivery_status: "queued" | "sent" | "failed" | "skipped"
      subscription_status:
        | "active"
        | "trialing"
        | "past_due"
        | "canceled"
        | "incomplete"
        | "incomplete_expired"
        | "unpaid"
        | "paused"
      subscription_tier: "free" | "basic" | "pro"
      whatsapp_status:
        | "disconnected"
        | "connecting"
        | "connected"
        | "logged_out"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      delivery_status: ["queued", "sent", "failed", "skipped"],
      subscription_status: [
        "active",
        "trialing",
        "past_due",
        "canceled",
        "incomplete",
        "incomplete_expired",
        "unpaid",
        "paused",
      ],
      subscription_tier: ["free", "basic", "pro"],
      whatsapp_status: [
        "disconnected",
        "connecting",
        "connected",
        "logged_out",
      ],
    },
  },
} as const
