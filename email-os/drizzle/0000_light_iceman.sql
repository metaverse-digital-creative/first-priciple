CREATE TABLE "classifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"email_id" text NOT NULL,
	"thread_id" text,
	"zone" varchar(10) NOT NULL,
	"score" integer NOT NULL,
	"confidence" real NOT NULL,
	"method" varchar(20) NOT NULL,
	"signals" jsonb,
	"reasoning" text,
	"classified_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "emails" (
	"id" text PRIMARY KEY NOT NULL,
	"thread_id" text NOT NULL,
	"from_email" text,
	"from_name" text,
	"subject" text,
	"snippet" text,
	"body" text,
	"labels" jsonb,
	"is_important" boolean DEFAULT false,
	"is_starred" boolean DEFAULT false,
	"in_reply_to" text,
	"received_at" timestamp with time zone,
	"ingested_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "insights" (
	"id" serial PRIMARY KEY NOT NULL,
	"thread_id" text,
	"type" varchar(30) NOT NULL,
	"message" text NOT NULL,
	"severity" varchar(10) DEFAULT 'info',
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent" varchar(20) NOT NULL,
	"cycle_number" integer,
	"sample_size" integer,
	"scores" jsonb,
	"feedback" jsonb,
	"evolution" jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "seeds" (
	"id" text PRIMARY KEY NOT NULL,
	"email_id" text,
	"thread_id" text,
	"type" varchar(30) NOT NULL,
	"zone" varchar(10) NOT NULL,
	"score" integer,
	"status" varchar(20) DEFAULT 'planted' NOT NULL,
	"shelf_life" varchar(10),
	"escalated" boolean DEFAULT false,
	"source_from" text,
	"source_subject" text,
	"notes" text,
	"outcome" jsonb,
	"planted_at" timestamp with time zone DEFAULT now(),
	"expires_at" timestamp with time zone,
	"harvested_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "suggestions" (
	"id" serial PRIMARY KEY NOT NULL,
	"email_id" text NOT NULL,
	"thread_id" text,
	"zone" varchar(10) NOT NULL,
	"actions" jsonb,
	"response_draft" jsonb,
	"priority" integer DEFAULT 50 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "threads" (
	"thread_id" text PRIMARY KEY NOT NULL,
	"subject" text,
	"participant_count" integer DEFAULT 0,
	"message_count" integer DEFAULT 0,
	"velocity" real DEFAULT 0,
	"temperature" real DEFAULT 0,
	"trajectory" varchar(20),
	"zones_seen" jsonb,
	"participants" jsonb,
	"last_message_at" timestamp with time zone,
	"first_message_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "classifications" ADD CONSTRAINT "classifications_email_id_emails_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."emails"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insights" ADD CONSTRAINT "insights_thread_id_threads_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("thread_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seeds" ADD CONSTRAINT "seeds_email_id_emails_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."emails"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_email_id_emails_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."emails"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_classifications_email" ON "classifications" USING btree ("email_id");--> statement-breakpoint
CREATE INDEX "idx_classifications_zone" ON "classifications" USING btree ("zone");--> statement-breakpoint
CREATE INDEX "idx_emails_thread" ON "emails" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "idx_emails_received" ON "emails" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "idx_insights_thread" ON "insights" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "idx_insights_type" ON "insights" USING btree ("type");--> statement-breakpoint
CREATE INDEX "idx_reviews_agent" ON "reviews" USING btree ("agent");--> statement-breakpoint
CREATE INDEX "idx_seeds_status" ON "seeds" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_seeds_zone" ON "seeds" USING btree ("zone");--> statement-breakpoint
CREATE INDEX "idx_seeds_expires" ON "seeds" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_suggestions_email" ON "suggestions" USING btree ("email_id");--> statement-breakpoint
CREATE INDEX "idx_suggestions_priority" ON "suggestions" USING btree ("priority");--> statement-breakpoint
CREATE INDEX "idx_threads_temperature" ON "threads" USING btree ("temperature");--> statement-breakpoint
CREATE INDEX "idx_threads_trajectory" ON "threads" USING btree ("trajectory");