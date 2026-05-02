import pandas as pd
import matplotlib.pyplot as plt
# import seaborn as sns

user_strength_dataset = '../dataset/06_user_tag_strengths.csv'
filtered_user_strength_dataset = '../dataset/08_filtered_user_tag_strengths.csv'

# load dataset
data = pd.read_csv(user_strength_dataset)
df = pd.DataFrame(data)


def clean():
    # Combine is_tle and is_mle into is_wa
    df['is_wa'] = (df['is_wa'] | df['is_tle'] | df['is_mle']).astype(int)

    # Drop records with no result (is_ac=0 and is_wa=0)
    df = df[~((df['is_ac'] == 0) & (df['is_wa'] == 0))]

    # Drop records with null problem name
    df = df.dropna(subset=['problem_name'])

    # Drop unnecessary columns
    features_to_keep = ['handle', 'problem_id', 'problem_name', 'problem_rating', 'is_ac', 'is_wa']
    # Add any tag columns that exist
    tag_columns = [col for col in df.columns if col.startswith('tag_')]

    features_to_keep.extend(tag_columns)
    df = df[features_to_keep]

    # Drop users with low accepted submission counts
    handle_counts = {}
    for idx, row in df.iterrows():
        if row['is_ac'] == 1:
            handle = row['handle']
            handle_counts[handle] = handle_counts.get(handle, 0) + 1

    def drop_low_acc_users(df, handle_counts, threshold=30):
        low_acc_handles = {handle for handle, count in handle_counts.items() if count < threshold}
        filtered_df = df[~df['handle'].isin(low_acc_handles)]
        return filtered_df

    df = drop_low_acc_users(df, handle_counts)

    # Drop problems with no tag and no rating
    df = df[~((df['problem_rating'] == 0) & (df[tag_columns].sum(axis=1) == 0))]


    # Export filtered dataset
    def export_filtered_dataset(df, out_path='../dataset/04_filtered_submissions.csv'):
        df.to_csv(out_path, index=False)
        print(f"\nDataset exported to {out_path}")

    # export_filtered_dataset(df)

print(df.info())
print("="*50)
for col in df.columns:
    print(f"{col}: {df[col].iloc[0]}")

handle_counts = {}
for handle in df['handle']:
    handle_counts[handle] = handle_counts.get(handle, 0) + 1

print("\nHandle counts (sample):")
for handle, count in list(handle_counts.items())[:10]:
    if count > 17:
        print(f"{handle}: {count}")