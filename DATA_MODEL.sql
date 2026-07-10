-- 销售周会复盘看板 v0.1 数据库草案
-- 推荐数据库：PostgreSQL
-- 说明：当前只是建模草案，正式接领星 ERP 时按实际接口字段微调。

create table bi_shop (
  id bigserial primary key,
  external_shop_id varchar(80),
  shop_name varchar(120) not null,
  marketplace varchar(40),
  country varchar(40),
  status varchar(20) default 'active',
  created_at timestamp default current_timestamp
);

create table bi_product (
  id bigserial primary key,
  sku varchar(120) not null,
  msku varchar(120),
  asin varchar(40),
  product_name varchar(300),
  category varchar(80),
  product_stage varchar(40),
  operator_name varchar(80),
  created_at timestamp default current_timestamp,
  unique (sku, msku, asin)
);

create table bi_sales_daily (
  id bigserial primary key,
  report_date date not null,
  shop_id bigint references bi_shop(id),
  product_id bigint references bi_product(id),
  sales_amount numeric(14, 2) default 0,
  sales_quantity integer default 0,
  order_count integer default 0,
  gross_profit numeric(14, 2) default 0,
  net_profit numeric(14, 2) default 0,
  platform_fee numeric(14, 2) default 0,
  product_cost numeric(14, 2) default 0,
  currency varchar(10) default 'CNY',
  created_at timestamp default current_timestamp,
  unique (report_date, shop_id, product_id)
);

create table bi_ad_daily (
  id bigserial primary key,
  report_date date not null,
  shop_id bigint references bi_shop(id),
  product_id bigint references bi_product(id),
  campaign_name varchar(200),
  ad_spend numeric(14, 2) default 0,
  ad_sales_amount numeric(14, 2) default 0,
  impressions integer default 0,
  clicks integer default 0,
  orders integer default 0,
  currency varchar(10) default 'CNY',
  created_at timestamp default current_timestamp
);

create table bi_refund_daily (
  id bigserial primary key,
  report_date date not null,
  shop_id bigint references bi_shop(id),
  product_id bigint references bi_product(id),
  refund_amount numeric(14, 2) default 0,
  refund_quantity integer default 0,
  return_quantity integer default 0,
  created_at timestamp default current_timestamp,
  unique (report_date, shop_id, product_id)
);

create table bi_target_monthly (
  id bigserial primary key,
  target_month date not null,
  shop_id bigint references bi_shop(id),
  category varchar(80),
  sales_target numeric(14, 2) default 0,
  store_profit_target numeric(14, 2) default 0,
  company_profit_target numeric(14, 2) default 0,
  created_by varchar(80),
  created_at timestamp default current_timestamp,
  unique (target_month, shop_id, category)
);

create table bi_sync_log (
  id bigserial primary key,
  source_name varchar(80) not null,
  sync_module varchar(80) not null,
  started_at timestamp not null,
  finished_at timestamp,
  status varchar(20) not null,
  rows_inserted integer default 0,
  error_message text
);

create table bi_user (
  id bigserial primary key,
  username varchar(80) not null unique,
  display_name varchar(80) not null,
  role_name varchar(40) not null,
  status varchar(20) default 'active',
  created_at timestamp default current_timestamp
);

create table bi_user_shop_permission (
  id bigserial primary key,
  user_id bigint references bi_user(id),
  shop_id bigint references bi_shop(id),
  unique (user_id, shop_id)
);
