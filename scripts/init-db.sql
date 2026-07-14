CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS workspaces (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workspace_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_email TEXT NOT NULL,
    role TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(workspace_id, user_email)
);

CREATE TABLE IF NOT EXISTS repositories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'github',
    url TEXT NOT NULL,
    default_branch TEXT NOT NULL DEFAULT 'main',
    local_path TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    indexed_commit_sha TEXT,
    indexed_at TIMESTAMP,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(workspace_id, name)
);

CREATE TABLE IF NOT EXISTS repository_sync_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending',
    started_at TIMESTAMP,
    finished_at TIMESTAMP,
    error TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS code_symbols (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    symbol_type TEXT NOT NULL,
    name TEXT NOT NULL,
    full_name TEXT NOT NULL,
    language TEXT NOT NULL,
    file_path TEXT NOT NULL,
    start_line INTEGER,
    end_line INTEGER,
    parent_name TEXT,
    parent_full_name TEXT,
    qdrant_collection TEXT,
    qdrant_point_id TEXT,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS code_chunks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    language TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    start_line INTEGER,
    end_line INTEGER,
    content TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    qdrant_collection TEXT,
    qdrant_point_id TEXT,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(repository_id, file_path, chunk_index)
);

CREATE TABLE IF NOT EXISTS code_relationships (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    relationship_type TEXT NOT NULL,
    source_name TEXT,
    target_name TEXT NOT NULL,
    source_file_path TEXT NOT NULL,
    target_file_path TEXT,
    language TEXT NOT NULL,
    start_line INTEGER,
    source_symbol_id UUID REFERENCES code_symbols(id) ON DELETE SET NULL,
    target_symbol_id UUID REFERENCES code_symbols(id) ON DELETE SET NULL,
    target_repository_id UUID REFERENCES repositories(id) ON DELETE SET NULL,
    resolution_status TEXT NOT NULL DEFAULT 'unresolved',
    resolution_metadata JSONB NOT NULL DEFAULT '{}',
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS code_index_files (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    language TEXT,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    content_hash TEXT,
    status TEXT NOT NULL,
    skipped_reason TEXT,
    error TEXT,
    indexed_at TIMESTAMP,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(repository_id, file_path)
);

CREATE TABLE IF NOT EXISTS code_business_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    rule_type TEXT NOT NULL,
    statement TEXT NOT NULL,
    confidence NUMERIC(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    confidence_reason TEXT NOT NULL,
    review_status TEXT NOT NULL DEFAULT 'proposed',
    evidence_status TEXT NOT NULL DEFAULT 'observed',
    evidence_score NUMERIC(4,3) NOT NULL DEFAULT 0.500 CHECK (evidence_score BETWEEN 0 AND 1),
    evidence_count INTEGER NOT NULL DEFAULT 1,
    semantic JSONB NOT NULL DEFAULT '{}',
    file_path TEXT NOT NULL,
    language TEXT NOT NULL,
    start_line INTEGER NOT NULL,
    end_line INTEGER,
    symbol_name TEXT,
    evidence TEXT NOT NULL,
    indexed_commit_sha TEXT,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(repository_id, file_path, start_line, rule_type)
);

CREATE TABLE IF NOT EXISTS code_research_sessions (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    repository_id UUID REFERENCES repositories(id) ON DELETE CASCADE,
    session JSONB NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS code_index_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    scope TEXT NOT NULL DEFAULT 'workspace',
    status TEXT NOT NULL DEFAULT 'pending',
    phase TEXT,
    current_repository TEXT,
    current_file TEXT,
    total_files INTEGER NOT NULL DEFAULT 0,
    files_indexed INTEGER NOT NULL DEFAULT 0,
    total_repository_files INTEGER NOT NULL DEFAULT 0,
    skipped_files INTEGER NOT NULL DEFAULT 0,
    total_chunks INTEGER NOT NULL DEFAULT 0,
    chunks_indexed INTEGER NOT NULL DEFAULT 0,
    symbols_indexed INTEGER NOT NULL DEFAULT 0,
    business_rules_indexed INTEGER NOT NULL DEFAULT 0,
    priority INTEGER NOT NULL DEFAULT 100,
    queue_position INTEGER,
    requested_by TEXT,
    locked_at TIMESTAMP,
    worker_id TEXT,
    started_after TIMESTAMP,
    metrics JSONB NOT NULL DEFAULT '{}',
    indexed_commit_sha TEXT,
    repository_dirty BOOLEAN NOT NULL DEFAULT FALSE,
    started_at TIMESTAMP,
    finished_at TIMESTAMP,
    error TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS code_index_queue_settings (
    id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
    paused BOOLEAN NOT NULL DEFAULT FALSE,
    max_concurrent_repositories INTEGER NOT NULL DEFAULT 1 CHECK (max_concurrent_repositories BETWEEN 1 AND 3),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO code_index_queue_settings (id, max_concurrent_repositories)
VALUES (TRUE, 1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS mcp_audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
    actor TEXT,
    server_name TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    request_metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS operational_logs (
    id BIGSERIAL PRIMARY KEY,
    level TEXT NOT NULL,
    component TEXT NOT NULL,
    message TEXT NOT NULL,
    context JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operational_logs_created_at ON operational_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_repositories_workspace_id ON repositories(workspace_id);
CREATE INDEX IF NOT EXISTS idx_code_symbols_workspace_id ON code_symbols(workspace_id);
CREATE INDEX IF NOT EXISTS idx_code_symbols_name ON code_symbols(name);
CREATE INDEX IF NOT EXISTS idx_code_symbols_full_name ON code_symbols(full_name);
CREATE INDEX IF NOT EXISTS idx_code_symbols_repository_id ON code_symbols(repository_id);
CREATE INDEX IF NOT EXISTS idx_code_symbols_parent_name ON code_symbols(parent_name);
CREATE INDEX IF NOT EXISTS idx_code_chunks_workspace_id ON code_chunks(workspace_id);
CREATE INDEX IF NOT EXISTS idx_code_chunks_repository_id ON code_chunks(repository_id);
CREATE INDEX IF NOT EXISTS idx_code_chunks_file_path ON code_chunks(file_path);
CREATE INDEX IF NOT EXISTS idx_code_relationships_workspace_id ON code_relationships(workspace_id);
CREATE INDEX IF NOT EXISTS idx_code_relationships_repository_id ON code_relationships(repository_id);
CREATE INDEX IF NOT EXISTS idx_code_relationships_target_name ON code_relationships(target_name);
CREATE INDEX IF NOT EXISTS idx_code_relationships_type ON code_relationships(relationship_type);
CREATE INDEX IF NOT EXISTS idx_code_relationships_source_symbol_id ON code_relationships(source_symbol_id);
CREATE INDEX IF NOT EXISTS idx_code_relationships_target_symbol_id ON code_relationships(target_symbol_id);
CREATE INDEX IF NOT EXISTS idx_code_relationships_target_repository_id ON code_relationships(target_repository_id);
CREATE INDEX IF NOT EXISTS idx_code_relationships_resolution_status ON code_relationships(resolution_status);
CREATE INDEX IF NOT EXISTS idx_code_index_files_workspace_id ON code_index_files(workspace_id);
CREATE INDEX IF NOT EXISTS idx_code_index_files_repository_id ON code_index_files(repository_id);
CREATE INDEX IF NOT EXISTS idx_code_index_files_status ON code_index_files(status);
CREATE INDEX IF NOT EXISTS idx_code_business_rules_workspace ON code_business_rules(workspace_id, confidence DESC);
CREATE INDEX IF NOT EXISTS idx_code_business_rules_repository ON code_business_rules(repository_id, file_path);
CREATE INDEX IF NOT EXISTS idx_code_business_rules_type ON code_business_rules(rule_type);
CREATE INDEX IF NOT EXISTS idx_code_business_rules_evidence_status ON code_business_rules(evidence_status, evidence_score DESC);
CREATE INDEX IF NOT EXISTS idx_code_research_sessions_expires ON code_research_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_code_index_jobs_repository_id ON code_index_jobs(repository_id);
CREATE INDEX IF NOT EXISTS idx_code_index_jobs_workspace_id ON code_index_jobs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_code_index_jobs_queue ON code_index_jobs(status, priority, queue_position, created_at);
