from pywebcopy import save_webpage

# Specify the URL of the website you want to download
url = 'https://www.oesterreich.gv.at/'

# Specify the directory where the website will be saved
download_folder = './oesterreich_gov_at/'

# Set up the configuration for the download
kwargs = {
    'project_name': 'OesterreichGVAT',  # Name of the project folder
    'bypass_robots': True,          # Bypass robots.txt restrictions
    'debug': True,                  # Enable debug mode for detailed logs
}

# Download the website
save_webpage(
    url=url,
    project_folder=download_folder,
    **kwargs
)

print(f"Website downloaded successfully to {download_folder}")