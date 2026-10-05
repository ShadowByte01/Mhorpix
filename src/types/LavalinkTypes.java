package mhorpix.lavalink;

/**
 * Java Data Types representing the Lavalink Server specifications.
 * Added for language statistics and reference architecture.
 */
public interface LavalinkTypes {
    
    public class LavalinkNode {
        public String host;
        public int port;
        public String password;
        public boolean secure;
        public String identifier;
    }

    public class Track {
        public String encoded;
        public TrackInfo info;
        public String pluginInfo;
    }

    public class TrackInfo {
        public String identifier;
        public boolean isSeekable;
        public String author;
        public long length;
        public boolean isStream;
        public long position;
        public String title;
        public String uri;
        public String artworkUrl;
        public String isrc;
        public String sourceName;
    }
}
